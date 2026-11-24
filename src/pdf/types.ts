import type {
  BlurAnalysisResult,
  DocumentSummaryResult,
  RgbaImageBuffer,
} from "../laplacian-blur-detector";

export interface ExtractedDocumentPage {
  pageNumber: number;
  width: number;
  height: number;
  rgba: RgbaImageBuffer;
  previewUri: string;
  hasVectorText?: boolean;
  textItemCount?: number;
}

export interface ExtractedPdfResult {
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  pages: ExtractedDocumentPage[];
}

export interface ImageSourceInput {
  uri: string;
  width?: number;
  height?: number;
  /** Optional JPEG base64 payload (or data URI) to decode directly without native image manipulation. */
  base64?: string;
}

export interface PdfSourceInput {
  uri: string;
  /** Optional Web `File` instance. */
  file?: File;
  /** Optional PDF base64 payload (or data URI) to avoid reading from filesystem. */
  base64?: string;
}

export interface PdfBridgePagePayload {
  pageNumber: number;
  totalPages: number;
  width: number;
  height: number;
  base64: string;
  hasVectorText: boolean;
  textItemCount: number;
}

export interface PdfBridgeResult {
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  pages: PdfBridgePagePayload[];
}

export interface PdfBridgeJobParams {
  base64: string;
  maxPages: number;
  targetMaxDim: number;
  onProgress?: (current: number, total: number) => void;
}

export type PdfBridgeRunner = (
  params: PdfBridgeJobParams,
) => Promise<PdfBridgeResult>;

export type ImageExtractAdapter = (
  source: ImageSourceInput,
  maxDim: number,
) => Promise<ExtractedDocumentPage>;

export type FileBase64Reader = (uri: string) => Promise<string>;

export interface ImageExtractOptions {
  maxDim?: number;
  extractImageAdapter?: ImageExtractAdapter;
}

export interface PdfExtractOptions {
  maxPages?: number;
  targetMaxDim?: number;
  onProgress?: (current: number, total: number) => void;
  renderPdfViaBridge?: PdfBridgeRunner;
  readFileAsBase64?: FileBase64Reader;
}

export interface AnalyzedDocumentItem {
  id: string;
  name: string;
  type: "image" | "pdf";
  size?: number;
  totalPages: number;
  truncated: boolean;
  pages: ExtractedDocumentPage[];
  pageAnalyses: BlurAnalysisResult[];
  summary: DocumentSummaryResult;
}
