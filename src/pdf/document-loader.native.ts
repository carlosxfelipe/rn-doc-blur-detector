import {
  base64ToUint8Array,
  decodeJpegBase64ToRgba,
  decodeJpegBytesToRgba,
  isJpegBytes,
  uint8ArrayToBase64,
} from "../base64-jpeg";
import {
  DEFAULT_LAPLACIAN_CONFIG,
  resizeRgbaIfNeeded,
} from "../laplacian-blur-detector";
import type {
  ExtractedDocumentPage,
  ExtractedPdfResult,
  ImageExtractOptions,
  ImageSourceInput,
  PdfExtractOptions,
  PdfSourceInput,
} from "./types";

function stripDataUriPrefix(input: string): string {
  const commaIdx = input.indexOf(",");
  return commaIdx !== -1 ? input.slice(commaIdx + 1) : input;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(stripDataUriPrefix(reader.result));
      } else {
        reject(new Error("Failed to read binary payload as base64."));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("FileReader failed while reading URI."));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Reads a `file://`, `content://`, `http(s)://`, or `data:` URI into raw bytes
 * using standard React Native `fetch` (no Expo or native FS module required).
 */
export async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  if (uri.startsWith("data:")) {
    return base64ToUint8Array(uri);
  }

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to read URI (${response.status}): ${uri}`);
  }

  if (typeof response.arrayBuffer === "function") {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  return base64ToUint8Array(base64);
}

/**
 * Reads a `file://`, `content://`, `http(s)://`, or `data:` URI as a raw base64 string
 * using standard React Native `fetch` + `FileReader`.
 */
export async function readUriAsBase64(uri: string): Promise<string> {
  if (uri.startsWith("data:")) {
    return stripDataUriPrefix(uri);
  }

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to read URI (${response.status}): ${uri}`);
  }

  if (
    typeof FileReader !== "undefined" &&
    typeof response.blob === "function"
  ) {
    const blob = await response.blob();
    return blobToBase64(blob);
  }

  const buffer = await response.arrayBuffer();
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

function normalizeImageOptions(
  maxDimOrOptions?: number | ImageExtractOptions,
): {
  maxDim: number;
  extractImageAdapter?: ImageExtractOptions["extractImageAdapter"];
} {
  if (typeof maxDimOrOptions === "number") {
    return { maxDim: maxDimOrOptions };
  }
  return {
    maxDim: maxDimOrOptions?.maxDim ?? DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
    extractImageAdapter: maxDimOrOptions?.extractImageAdapter,
  };
}

/**
 * Extracts RGBA pixels from an image on React Native (Expo or Bare RN).
 */
export async function extractImagePage(
  source: ImageSourceInput,
  maxDimOrOptions:
    number | ImageExtractOptions = DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
): Promise<ExtractedDocumentPage> {
  const { maxDim, extractImageAdapter } =
    normalizeImageOptions(maxDimOrOptions);

  if (source.base64) {
    const decoded = decodeJpegBase64ToRgba(source.base64);
    const rgba = resizeRgbaIfNeeded(decoded, maxDim);
    const rawBase64 = stripDataUriPrefix(source.base64);
    return {
      pageNumber: 1,
      width: rgba.width,
      height: rgba.height,
      rgba,
      previewUri: source.uri || `data:image/jpeg;base64,${rawBase64}`,
      hasVectorText: false,
      textItemCount: 0,
    };
  }

  if (extractImageAdapter) {
    return extractImageAdapter(source, maxDim);
  }

  if (/^data:image\/jpe?g;base64,/i.test(source.uri)) {
    const decoded = decodeJpegBase64ToRgba(source.uri);
    const rgba = resizeRgbaIfNeeded(decoded, maxDim);
    return {
      pageNumber: 1,
      width: rgba.width,
      height: rgba.height,
      rgba,
      previewUri: source.uri,
      hasVectorText: false,
      textItemCount: 0,
    };
  }

  const bytes = await readUriAsBytes(source.uri);
  if (!isJpegBytes(bytes)) {
    throw new Error(
      "Non-JPEG image URI on React Native requires an `extractImageAdapter` or a JPEG `base64` payload.",
    );
  }

  const decoded = decodeJpegBytesToRgba(bytes);
  const rgba = resizeRgbaIfNeeded(decoded, maxDim);

  return {
    pageNumber: 1,
    width: rgba.width,
    height: rgba.height,
    rgba,
    previewUri: source.uri,
    hasVectorText: false,
    textItemCount: 0,
  };
}

/**
 * Extracts rendered PDF pages on iOS/Android via a WebView PDF.js bridge (`renderPdfViaBridge`),
 * then decodes each page into RGBA pixels in TypeScript for Laplacian analysis.
 */
export async function extractPdfPages(
  source: PdfSourceInput,
  options: PdfExtractOptions = {},
): Promise<ExtractedPdfResult> {
  const {
    maxPages = 2,
    targetMaxDim = DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
    onProgress,
    renderPdfViaBridge,
    readFileAsBase64,
  } = options;

  if (!renderPdfViaBridge) {
    throw new Error(
      "Missing `renderPdfViaBridge` callback. Connect a WebView with `PDF_WEBVIEW_HTML` and `createPdfBridgeController()`.",
    );
  }

  const base64 = source.base64
    ? stripDataUriPrefix(source.base64)
    : readFileAsBase64
      ? await readFileAsBase64(source.uri)
      : await readUriAsBase64(source.uri);

  const bridgeResult = await renderPdfViaBridge({
    base64,
    maxPages,
    targetMaxDim,
    onProgress,
  });

  const pages: ExtractedDocumentPage[] = bridgeResult.pages.map((page) => {
    const rgba = decodeJpegBase64ToRgba(page.base64);
    return {
      pageNumber: page.pageNumber,
      width: rgba.width,
      height: rgba.height,
      rgba,
      previewUri: `data:image/jpeg;base64,${page.base64}`,
      hasVectorText: page.hasVectorText,
      textItemCount: page.textItemCount,
    };
  });

  return {
    totalPages: bridgeResult.totalPages,
    processedPages: bridgeResult.processedPages,
    truncated: bridgeResult.truncated,
    pages,
  };
}
