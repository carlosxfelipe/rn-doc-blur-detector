import { buildPdfWebViewHtml } from "./pdf-webview-template";

const PDFJS_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

/**
 * WebView HTML document that uses PDF.js (via jsDelivr CDN) for Web/fallback
 * environments. iOS and Android resolve `pdf-webview-html.native` (vendored offline).
 */
export const PDF_WEBVIEW_HTML = buildPdfWebViewHtml(`
  const PDFJS_URL = "${PDFJS_URL}";
  const PDFJS_WORKER_URL = "${PDFJS_WORKER_URL}";

  async function getPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(PDFJS_URL).then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return mod;
      });
    }
    return pdfjsPromise;
  }
`);
