import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import jpeg from "jpeg-js";

const require = createRequire(import.meta.url);

const cjsCore = require("../lib/commonjs/index.js");
const cjsPdf = require("../lib/commonjs/pdf/index.js");

function createSolidRgba(width, height, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width, height, data };
}

function createSharpCheckerboardRgba(width, height, cellSize = 4) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark =
        (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0;
      const val = dark ? 20 : 240;
      const idx = (y * width + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

function boxBlurRgba(image, passes = 4) {
  const { width, height } = image;
  let src = new Uint8ClampedArray(image.data);
  let dst = new Uint8ClampedArray(image.data.length);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -2; dx <= 2; dx++) {
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            const idx = (ny * width + nx) * 4;
            r += src[idx];
            g += src[idx + 1];
            b += src[idx + 2];
            count++;
          }
        }
        const outIdx = (y * width + x) * 4;
        dst[outIdx] = Math.round(r / count);
        dst[outIdx + 1] = Math.round(g / count);
        dst[outIdx + 2] = Math.round(b / count);
        dst[outIdx + 3] = 255;
      }
    }
    src = new Uint8ClampedArray(dst);
  }

  return { width, height, data: dst };
}

test("blank white buffer is classified as insufficient", () => {
  const blank = createSolidRgba(120, 120, 255, 255, 255);
  const res = cjsCore.analyzeGlobalLaplacianBlur(blank);
  assert.equal(res.status, "insufficient");
  assert.equal(res.score, 0);
  assert.equal(res.label, "Conteúdo Insuficiente");
});

test("sharp high-contrast pattern scores sharp and blurred pattern scores significantly lower", () => {
  const sharp = createSharpCheckerboardRgba(160, 160, 4);
  const sharpRes = cjsCore.analyzeGlobalLaplacianBlur(sharp);
  assert.equal(sharpRes.status, "sharp");
  assert.ok(sharpRes.score >= 60, `Expected score >= 60, got ${sharpRes.score}`);

  const blurred = boxBlurRgba(sharp, 4);
  const blurredRes = cjsCore.analyzeGlobalLaplacianBlur(blurred);
  assert.ok(
    blurredRes.metrics.globalLaplacianVar <
      sharpRes.metrics.globalLaplacianVar,
  );
  assert.ok(blurredRes.score < sharpRes.score);
  assert.notEqual(blurredRes.status, "sharp");
});

test("locale 'en' switches labels and messages to English", () => {
  const blank = createSolidRgba(64, 64, 250, 250, 250);
  const res = cjsCore.analyzeGlobalLaplacianBlur(blank, { locale: "en" });
  assert.equal(res.status, "insufficient");
  assert.equal(res.label, "Insufficient Content");
});

test("resizeRgbaIfNeeded downsamples oversized buffers proportionally", () => {
  const big = createSolidRgba(2000, 1000, 128, 128, 128);
  const resized = cjsCore.resizeRgbaIfNeeded(big, 1000);
  assert.equal(resized.width, 1000);
  assert.equal(resized.height, 500);

  const untouched = cjsCore.resizeRgbaIfNeeded(resized, 1400);
  assert.equal(untouched, resized);
});

test("aggregateDocumentResults summarizes multi-page results properly", () => {
  const empty = cjsCore.aggregateDocumentResults([]);
  assert.equal(empty.status, "insufficient");

  const sharp = cjsCore.analyzeGlobalLaplacianBlur(
    createSharpCheckerboardRgba(120, 120, 4),
  );
  const blurry = {
    ...sharp,
    status: "blurry",
    score: 22,
  };

  const summary = cjsCore.aggregateDocumentResults([sharp, blurry]);
  assert.equal(summary.status, "blurry");
  assert.equal(summary.score, 22);
  assert.deepEqual(summary.affectedPages, [2]);
});

test("base64 roundtrip and JPEG base64 blur analysis work without Node Buffer", () => {
  const raw = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const b64 = cjsCore.uint8ArrayToBase64(raw);
  const decodedBytes = cjsCore.base64ToUint8Array(
    `data:application/octet-stream;base64,\n${b64}`,
  );
  assert.deepEqual(decodedBytes, raw);

  const sharpImg = createSharpCheckerboardRgba(96, 96, 4);
  const encodedJpeg = jpeg.encode(
    {
      width: sharpImg.width,
      height: sharpImg.height,
      data: sharpImg.data,
    },
    95,
  );
  assert.equal(cjsCore.isJpegBytes(encodedJpeg.data), true);

  const jpegB64 = cjsCore.uint8ArrayToBase64(encodedJpeg.data);
  const analysis = cjsCore.analyzeJpegBase64Blur(jpegB64);
  assert.equal(analysis.status, "sharp");
  assert.equal(analysis.metrics.analyzedWidth, 96);
  assert.equal(analysis.metrics.analyzedHeight, 96);
});

test("pdf bridge controller processes WebView messages and resolves pages", async () => {
  const controller = cjsPdf.createPdfBridgeController({ readyTimeoutMs: 500 });
  assert.equal(controller.isReady(), false);

  controller.handleMessage(JSON.stringify({ type: "ready" }));
  assert.equal(controller.isReady(), true);

  let injectedScript = "";
  const jobPromise = controller.runJob(
    { base64: "JVBERi0xLjQK", maxPages: 2, targetMaxDim: 1400 },
    (script) => {
      injectedScript = script;
    },
  );

  await new Promise((r) => setTimeout(r, 0));
  const match = injectedScript.match(/"requestId":"([^"]+)"/);
  assert.ok(match, "Expected requestId in injected script");
  const requestId = match[1];

  controller.handleMessage(
    JSON.stringify({
      type: "page",
      requestId,
      pageNumber: 1,
      totalPages: 1,
      width: 100,
      height: 100,
      base64: "abc",
      hasVectorText: true,
      textItemCount: 3,
    }),
  );
  controller.handleMessage(
    JSON.stringify({
      type: "done",
      requestId,
      totalPages: 1,
      processedPages: 1,
      truncated: false,
    }),
  );

  const res = await jobPromise;
  assert.equal(res.totalPages, 1);
  assert.equal(res.pages.length, 1);
  assert.equal(res.pages[0].hasVectorText, true);
});

test("document asset helpers and buildAnalyzedDocument work as expected", () => {
  assert.equal(cjsPdf.formatBytes(undefined), "");
  assert.equal(cjsPdf.formatBytes(512), "512 B");
  assert.equal(cjsPdf.formatBytes(2048), "2.0 KB");
  assert.equal(cjsPdf.formatBytes(2 * 1024 * 1024), "2.00 MB");

  assert.equal(cjsPdf.isPdfAsset("doc.PDF"), true);
  assert.equal(cjsPdf.isPdfAsset("file", "application/pdf"), true);
  assert.equal(cjsPdf.isPdfAsset("photo.jpg", "image/jpeg"), false);

  assert.equal(cjsPdf.isImageAsset("photo.HEIC"), true);
  assert.equal(cjsPdf.isImageAsset("blob", "image/png"), true);
  assert.equal(cjsPdf.isImageAsset("doc.pdf", "application/pdf"), false);

  const sharp = createSharpCheckerboardRgba(120, 120, 4);
  const analyzed = cjsPdf.buildAnalyzedDocument({
    id: "doc-1",
    name: "scan.jpg",
    type: "image",
    totalPages: 1,
    truncated: false,
    pages: [
      {
        pageNumber: 1,
        width: 120,
        height: 120,
        rgba: sharp,
        previewUri: "file:///scan.jpg",
      },
    ],
  });

  assert.equal(analyzed.pageAnalyses.length, 1);
  assert.equal(analyzed.summary.status, "sharp");
  assert.ok(analyzed.summary.score >= 60);

  assert.equal(cjsPdf.validateFileSize(1024, 9).valid, true);
  assert.equal(cjsPdf.validateFileSize(10 * 1024 * 1024, 9).valid, false);
});

test("analyzeLuminanceBlur works directly on grayscale buffers and guards invalid inputs", () => {
  const sharp = createSharpCheckerboardRgba(100, 100, 4);
  const { lum } = cjsCore.toGrayscaleLuminance(
    sharp.data,
    sharp.width,
    sharp.height,
  );
  const lumResult = cjsCore.analyzeLuminanceBlur(lum, sharp.width, sharp.height);
  assert.equal(lumResult.status, "sharp");
  assert.ok(lumResult.score >= 60);

  const invalidRgba = cjsCore.analyzeGlobalLaplacianBlur({
    width: 0,
    height: 10,
    data: new Uint8Array(0),
  });
  assert.equal(invalidRgba.status, "insufficient");

  const invalidLum = cjsCore.analyzeLuminanceBlur([], 10, 10);
  assert.equal(invalidLum.status, "insufficient");

  assert.throws(
    () => cjsCore.decodeJpegBytesToRgba(new Uint8Array([1, 2, 3])),
    /Invalid or empty JPEG payload/,
  );
});

test("pdf bridge controller supports cancel, reset, and job timeout", async () => {
  const controller = cjsPdf.createPdfBridgeController({
    readyTimeoutMs: 200,
    jobTimeoutMs: 40,
  });
  controller.handleMessage(JSON.stringify({ type: "ready" }));

  const timeoutPromise = controller.runJob(
    { base64: "JVBERi0=", maxPages: 1, targetMaxDim: 1400 },
    () => {},
  );
  await assert.rejects(timeoutPromise, /Timed out while rendering PDF pages/);

  const cancelPromise = controller.runJob(
    { base64: "JVBERi0=", maxPages: 1, targetMaxDim: 1400 },
    () => {},
  );
  await new Promise((r) => setTimeout(r, 0));
  controller.cancel("Aborted by test");
  await assert.rejects(cancelPromise, /Aborted by test/);

  controller.reset();
  assert.equal(controller.isReady(), false);
});

test("extractPdfPages defaults to native bridge loader outside browser DOM", async () => {
  await assert.rejects(
    cjsPdf.extractPdfPages({ uri: "file:///doc.pdf" }),
    /Missing `renderPdfViaBridge` callback/,
  );
});

test("PDF_WEBVIEW_HTML uses vendored offline PDF.js on native and CDN on web", () => {
  const nativeHtml = require("../lib/commonjs/pdf/pdf-webview-html.native.js");
  assert.match(nativeHtml.PDF_WEBVIEW_HTML, /base64ToJsBlobUrl/);
  assert.doesNotMatch(nativeHtml.PDF_WEBVIEW_HTML, /cdn\.jsdelivr\.net/);

  assert.match(cjsPdf.PDF_WEBVIEW_HTML, /cdn\.jsdelivr\.net/);
  assert.doesNotMatch(cjsPdf.PDF_WEBVIEW_HTML, /base64ToJsBlobUrl/);
});
