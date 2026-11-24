import { buildPdfWebViewHtml } from "./pdf-webview-template";
import { PDFJS_LIB_BASE64, PDFJS_WORKER_BASE64 } from "./vendor/pdfjs-bundle";

/**
 * Hidden WebView HTML document that uses vendored PDF.js (offline, via Blob URLs)
 * to render PDF pages to high-quality JPEG frames on iOS and Android without network
 * or native PDF libs.
 */
export const PDF_WEBVIEW_HTML = buildPdfWebViewHtml(`
  function base64ToJsBlobUrl(base64) {
    const bytes = base64ToBytes(base64);
    return URL.createObjectURL(
      new Blob([bytes], { type: "text/javascript" }),
    );
  }

  async function getPdfJs() {
    if (!pdfjsPromise) {
      const libUrl = base64ToJsBlobUrl("${PDFJS_LIB_BASE64}");
      const workerUrl = base64ToJsBlobUrl("${PDFJS_WORKER_BASE64}");
      pdfjsPromise = import(libUrl).then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
        return mod;
      });
    }
    return pdfjsPromise;
  }
`);
