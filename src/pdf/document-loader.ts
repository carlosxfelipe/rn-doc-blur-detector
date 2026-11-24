import * as nativeLoader from "./document-loader.native";
import * as webLoader from "./document-loader.web";
import type {
  ExtractedDocumentPage,
  ExtractedPdfResult,
  ImageExtractOptions,
  ImageSourceInput,
  PdfExtractOptions,
  PdfSourceInput,
} from "./types";

function isBrowserDom(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof window !== "undefined" &&
    typeof window.Image === "function"
  );
}

/**
 * Extracts RGBA pixels from an image using browser Canvas when in a DOM
 * environment, or the React Native JPEG decoder otherwise.
 */
export function extractImagePage(
  source: ImageSourceInput,
  maxDimOrOptions?: number | ImageExtractOptions,
): Promise<ExtractedDocumentPage> {
  return (
    isBrowserDom() ? webLoader.extractImagePage : nativeLoader.extractImagePage
  )(source, maxDimOrOptions);
}

/**
 * Extracts rendered PDF pages using PDF.js directly in a browser DOM, or the
 * React Native WebView bridge otherwise.
 */
export function extractPdfPages(
  source: PdfSourceInput,
  options?: PdfExtractOptions,
): Promise<ExtractedPdfResult> {
  return (
    isBrowserDom() ? webLoader.extractPdfPages : nativeLoader.extractPdfPages
  )(source, options);
}

/**
 * Reads a URI as a raw base64 string using the runtime-appropriate loader.
 */
export function readUriAsBase64(uri: string): Promise<string> {
  return (
    isBrowserDom() ? webLoader.readUriAsBase64 : nativeLoader.readUriAsBase64
  )(uri);
}

/**
 * Reads a URI into raw bytes using the runtime-appropriate loader.
 */
export function readUriAsBytes(uri: string): Promise<Uint8Array> {
  return (
    isBrowserDom() ? webLoader.readUriAsBytes : nativeLoader.readUriAsBytes
  )(uri);
}
