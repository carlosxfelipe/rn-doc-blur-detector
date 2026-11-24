/**
 * Shared HTML template for the hidden WebView that renders PDF pages using PDF.js.
 */
export function buildPdfWebViewHtml(getPdfJsSnippet: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <script type="module">
      let pdfjsPromise = null;

      function postToNative(payload) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      function base64ToBytes(base64) {
        const commaIdx = base64.indexOf(",");
        const raw = commaIdx !== -1 ? base64.slice(commaIdx + 1) : base64;
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
          bytes[i] = bin.charCodeAt(i);
        }
        return bytes;
      }

      ${getPdfJsSnippet}

      window.__startPdfJob = async function (job) {
        const { requestId, base64, maxPages = 2, targetMaxDim = 1400 } = job;
        try {
          const pdfjsLib = await getPdfJs();
          const data = base64ToBytes(base64);
          const pdf = await pdfjsLib.getDocument({ data }).promise;
          const totalPages = pdf.numPages;
          const pagesToProcess = Math.min(totalPages, maxPages);

          for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber++) {
            postToNative({
              type: "progress",
              requestId,
              current: pageNumber,
              total: pagesToProcess,
            });

            const page = await pdf.getPage(pageNumber);
            const baseViewport = page.getViewport({ scale: 1 });
            const longest = Math.max(baseViewport.width, baseViewport.height) || 1;
            const scale = Math.min(2.5, Math.max(1.0, targetMaxDim / longest));
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement("canvas");
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);

            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            let textItemCount = 0;
            try {
              const textContent = await page.getTextContent();
              textItemCount = textContent.items.filter(
                (it) => it.str && it.str.trim().length > 0,
              ).length;
            } catch {
              textItemCount = 0;
            }

            const dataUrl = canvas.toDataURL("image/jpeg", 0.96);
            const jpegBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

            postToNative({
              type: "page",
              requestId,
              pageNumber,
              totalPages,
              width: canvas.width,
              height: canvas.height,
              base64: jpegBase64,
              hasVectorText: textItemCount > 0,
              textItemCount,
            });
          }

          postToNative({
            type: "done",
            requestId,
            totalPages,
            processedPages: pagesToProcess,
            truncated: totalPages > pagesToProcess,
          });
        } catch (err) {
          postToNative({
            type: "error",
            requestId,
            message: (err && err.message) || "Failed to render PDF document.",
          });
        }
      };

      postToNative({ type: "ready" });
    </script>
  </body>
</html>
`;
}
