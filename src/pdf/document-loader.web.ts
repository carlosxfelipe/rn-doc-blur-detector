import { base64ToUint8Array, uint8ArrayToBase64 } from "../base64-jpeg";
import { DEFAULT_LAPLACIAN_CONFIG } from "../laplacian-blur-detector";
import type {
  ExtractedDocumentPage,
  ExtractedPdfResult,
  ImageExtractOptions,
  ImageSourceInput,
  PdfExtractOptions,
  PdfSourceInput,
} from "./types";

const PDFJS_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

interface PdfJsPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: { str?: string }[] }>;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNum: number) => Promise<PdfJsPage>;
    }>;
  };
}

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    const dynamicImport = new Function("url", "return import(url)") as (
      url: string,
    ) => Promise<PdfJsModule>;
    pdfjsPromise = dynamicImport(PDFJS_URL).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    });
  }
  return pdfjsPromise;
}

export async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  if (uri.startsWith("data:")) {
    return base64ToUint8Array(uri);
  }
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch URI (${response.status}): ${uri}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function readUriAsBase64(uri: string): Promise<string> {
  const bytes = await readUriAsBytes(uri);
  return uint8ArrayToBase64(bytes);
}

/**
 * Decodes an image URI or base64 payload via browser HTMLCanvasElement into RGBA pixels.
 */
export async function extractImagePage(
  source: ImageSourceInput,
  maxDimOrOptions:
    number | ImageExtractOptions = DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
): Promise<ExtractedDocumentPage> {
  const maxDim =
    typeof maxDimOrOptions === "number"
      ? maxDimOrOptions
      : (maxDimOrOptions?.maxDim ?? DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim);

  const imageSrc = source.base64
    ? source.base64.startsWith("data:")
      ? source.base64
      : `data:image/jpeg;base64,${source.base64}`
    : source.uri;

  return new Promise((resolve, reject) => {
    const img = new window.Image();
    if (/^https?:\/\//i.test(imageSrc)) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;
        const longest = Math.max(naturalW, naturalH) || 1;
        const scale = longest > maxDim ? maxDim / longest : 1;
        const width = Math.max(16, Math.round(naturalW * scale));
        const height = Math.max(16, Math.round(naturalH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("Could not obtain 2D canvas context."));
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);

        resolve({
          pageNumber: 1,
          width,
          height,
          rgba: {
            width,
            height,
            data: imageData.data,
          },
          previewUri: source.uri || imageSrc,
          hasVectorText: false,
          textItemCount: 0,
        });
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error("Failed to read image pixels."),
        );
      }
    };

    img.onerror = () => {
      reject(new Error("Could not load selected image."));
    };

    img.src = imageSrc;
  });
}

/**
 * Renders PDF pages on Web via PDF.js CDN into RGBA buffers + preview data URLs.
 */
export async function extractPdfPages(
  source: PdfSourceInput,
  options: PdfExtractOptions = {},
): Promise<ExtractedPdfResult> {
  const {
    maxPages = 2,
    targetMaxDim = DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
    onProgress,
  } = options;

  const pdfjsLib = await getPdfJs();
  const data = source.base64
    ? base64ToUint8Array(source.base64)
    : source.file
      ? new Uint8Array(await source.file.arrayBuffer())
      : new Uint8Array(await (await fetch(source.uri)).arrayBuffer());

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;
  const pagesToProcess = Math.min(totalPages, maxPages);
  const pages: ExtractedDocumentPage[] = [];

  for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber++) {
    onProgress?.(pageNumber, pagesToProcess);

    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const longest = Math.max(baseViewport.width, baseViewport.height) || 1;
    const scale = Math.min(2.5, Math.max(1.0, targetMaxDim / longest));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not obtain 2D canvas context for PDF page.");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    let textItemCount = 0;
    try {
      const textContent = await page.getTextContent();
      textItemCount = textContent.items.filter(
        (item) => item.str && item.str.trim().length > 0,
      ).length;
    } catch {
      textItemCount = 0;
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const previewUri = canvas.toDataURL("image/jpeg", 0.92);

    pages.push({
      pageNumber,
      width: canvas.width,
      height: canvas.height,
      rgba: {
        width: canvas.width,
        height: canvas.height,
        data: imageData.data,
      },
      previewUri,
      hasVectorText: textItemCount > 0,
      textItemCount,
    });
  }

  return {
    totalPages,
    processedPages: pagesToProcess,
    truncated: totalPages > pagesToProcess,
    pages,
  };
}
