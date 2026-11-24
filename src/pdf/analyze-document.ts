import {
  aggregateDocumentResults,
  analyzeGlobalLaplacianBlur,
  type BlurAnalysisResult,
  DEFAULT_LAPLACIAN_CONFIG,
  type DocumentSummaryResult,
  type LaplacianBlurConfig,
} from "../laplacian-blur-detector";
import { extractImagePage, extractPdfPages } from "./document-loader";
import type {
  AnalyzedDocumentItem,
  ExtractedDocumentPage,
  ImageExtractOptions,
  ImageSourceInput,
  PdfExtractOptions,
  PdfSourceInput,
} from "./types";

export const DEFAULT_MAX_FILE_SIZE_MB = 9;
export const DEFAULT_MAX_FILE_SIZE_BYTES =
  DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|heic|heif|bmp|gif|tiff?)$/i;

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isPdfAsset(name: string, mimeType?: string): boolean {
  return mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

export function isImageAsset(name: string, mimeType?: string): boolean {
  if (mimeType) {
    return mimeType.startsWith("image/");
  }
  return IMAGE_EXTENSION_RE.test(name);
}

export interface FileSizeValidationResult {
  valid: boolean;
  sizeBytes?: number;
  maxBytes: number;
  formattedSize: string;
}

export function validateFileSize(
  sizeBytes?: number,
  maxSizeMb = DEFAULT_MAX_FILE_SIZE_MB,
): FileSizeValidationResult {
  const maxBytes = maxSizeMb * 1024 * 1024;
  const formattedSize = formatBytes(sizeBytes);
  const valid =
    !(maxSizeMb > 0 && Number.isFinite(maxSizeMb)) ||
    typeof sizeBytes !== "number" ||
    sizeBytes <= maxBytes;

  return {
    valid,
    sizeBytes,
    maxBytes,
    formattedSize,
  };
}

/**
 * Runs Global Laplacian analysis on extracted pages and assembles an `AnalyzedDocumentItem`.
 */
export function buildAnalyzedDocument(
  item: Omit<AnalyzedDocumentItem, "pageAnalyses" | "summary">,
  config?: Partial<LaplacianBlurConfig>,
): AnalyzedDocumentItem {
  const pageAnalyses = item.pages.map((page) =>
    analyzeGlobalLaplacianBlur(page.rgba, config),
  );
  const summary = aggregateDocumentResults(pageAnalyses, {
    locale: config?.locale,
    messages: config?.messages,
  });

  return {
    ...item,
    pageAnalyses,
    summary,
  };
}

export interface AnalyzeImageOptions extends ImageExtractOptions {
  config?: Partial<LaplacianBlurConfig>;
}

export interface AnalyzeImageResult {
  page: ExtractedDocumentPage;
  analysis: BlurAnalysisResult;
}

export interface AnalyzePdfOptions extends PdfExtractOptions {
  config?: Partial<LaplacianBlurConfig>;
}

export interface AnalyzePdfResult {
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  pages: ExtractedDocumentPage[];
  pageAnalyses: BlurAnalysisResult[];
  summary: DocumentSummaryResult;
}

/**
 * High-level helper that extracts RGBA pixels from an image and runs Laplacian blur analysis.
 */
export async function analyzeImage(
  source: ImageSourceInput,
  options: AnalyzeImageOptions = {},
): Promise<AnalyzeImageResult> {
  const maxDim =
    options.maxDim ??
    options.config?.maxAnalysisDim ??
    DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim;

  const page = await extractImagePage(source, {
    maxDim,
    extractImageAdapter: options.extractImageAdapter,
  });
  const analysis = analyzeGlobalLaplacianBlur(page.rgba, options.config);
  return { page, analysis };
}

/**
 * High-level helper that rasterizes PDF pages and runs per-page + aggregated blur analysis.
 */
export async function analyzePdf(
  source: PdfSourceInput,
  options: AnalyzePdfOptions = {},
): Promise<AnalyzePdfResult> {
  const targetMaxDim =
    options.targetMaxDim ??
    options.config?.maxAnalysisDim ??
    DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim;

  const pdfResult = await extractPdfPages(source, {
    maxPages: options.maxPages,
    targetMaxDim,
    onProgress: options.onProgress,
    renderPdfViaBridge: options.renderPdfViaBridge,
    readFileAsBase64: options.readFileAsBase64,
  });

  const pageAnalyses = pdfResult.pages.map((page) =>
    analyzeGlobalLaplacianBlur(page.rgba, options.config),
  );
  const summary = aggregateDocumentResults(pageAnalyses, {
    locale: options.config?.locale,
    messages: options.config?.messages,
  });

  return {
    totalPages: pdfResult.totalPages,
    processedPages: pdfResult.processedPages,
    truncated: pdfResult.truncated,
    pages: pdfResult.pages,
    pageAnalyses,
    summary,
  };
}
