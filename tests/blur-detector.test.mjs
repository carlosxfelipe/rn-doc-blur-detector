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

function createFramedBuffer(width, height, bgRgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgRgb[0];
    data[i + 1] = bgRgb[1];
    data[i + 2] = bgRgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function drawDocumentRect(buf, x0, y0, x1, y1, docRgb) {
  const { width, height, data } = buf;
  const cx0 = Math.max(0, Math.round(x0));
  const cy0 = Math.max(0, Math.round(y0));
  const cx1 = Math.min(width - 1, Math.round(x1));
  const cy1 = Math.min(height - 1, Math.round(y1));

  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const idx = (y * width + x) * 4;
      const inInnerTextBand =
        x > cx0 + 8 &&
        x < cx1 - 8 &&
        y > cy0 + 8 &&
        y < cy1 - 8 &&
        y % 12 < 3 &&
        x % 5 < 3;
      data[idx] = inInnerTextBand ? 30 : docRgb[0];
      data[idx + 1] = inInnerTextBand ? 30 : docRgb[1];
      data[idx + 2] = inInnerTextBand ? 30 : docRgb[2];
      data[idx + 3] = 255;
    }
  }
}

test("analyzeDocumentFraming evaluates A4, ID cards, clipped edges, and full-page scans", () => {
  const blank = createSolidRgba(120, 120, 245, 245, 245);
  assert.equal(cjsCore.analyzeDocumentFraming(blank, "auto").status, "insufficient");

  const a4 = createFramedBuffer(240, 300, [35, 30, 25]);
  drawDocumentRect(a4, 45, 44, 195, 256, [246, 246, 246]);
  const a4Res = cjsCore.analyzeDocumentFraming(a4, "a4");
  assert.equal(a4Res.status, "good");
  assert.deepEqual(a4Res.metrics.clippedEdges, []);

  const clipped = createFramedBuffer(240, 240, [30, 30, 30]);
  drawDocumentRect(clipped, 60, 50, 239, 239, [245, 245, 245]);
  const clippedRes = cjsCore.analyzeDocumentFraming(clipped, "a4");
  assert.equal(clippedRes.status, "poor");
  assert.ok(clippedRes.metrics.clippedEdges.includes("right"));
  assert.ok(clippedRes.metrics.clippedEdges.includes("bottom"));

  const fullScan = createFramedBuffer(210, 297, [250, 250, 250]);
  drawDocumentRect(fullScan, 18, 18, 192, 279, [250, 250, 250]);
  const scanRes = cjsCore.analyzeDocumentFraming(fullScan, "a4");
  assert.equal(scanRes.status, "good");
  assert.equal(scanRes.metrics.isFullPageScan, true);
});

test("analyzeGlobalLaplacianBlur attaches framing analysis only when requested", () => {
  const card = createFramedBuffer(180, 320, [36, 32, 30]);
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 180; x++) {
      const idx = (y * 180 + x) * 4;
      card.data[idx] = 205;
      card.data[idx + 1] = 152;
      card.data[idx + 2] = 140;
    }
  }
  drawDocumentRect(card, 5, 46, 174, 278, [216, 222, 204]);

  const withoutFraming = cjsCore.analyzeGlobalLaplacianBlur(card);
  assert.equal(withoutFraming.framing, undefined);

  const offFraming = cjsCore.analyzeGlobalLaplacianBlur(card, { framing: "off" });
  assert.equal(offFraming.framing, undefined);

  const withFraming = cjsCore.analyzeGlobalLaplacianBlur(card, {
    framing: "id-card",
    locale: "en",
  });
  assert.ok(withFraming.framing);
  assert.equal(withFraming.framing.status, "good");
  assert.equal(withFraming.framing.profile, "id-card");
});

function buildExifApp1Segment(orientation, littleEndian = true) {
  // APP1 marker (2) + length (2) + "Exif\0\0" (6) + TIFF header (8) + IFD0 count (2) + 2 entries (24) + next IFD (4) = 48 bytes
  const seg = new Uint8Array(48);
  const view = new DataView(seg.buffer);

  seg[0] = 0xff;
  seg[1] = 0xe1;
  view.setUint16(2, 46, false); // segment length excluding 0xFF 0xE1

  // "Exif\0\0"
  seg[4] = 0x45;
  seg[5] = 0x78;
  seg[6] = 0x69;
  seg[7] = 0x66;
  seg[8] = 0x00;
  seg[9] = 0x00;

  const tiff = 10;
  seg[tiff] = littleEndian ? 0x49 : 0x4d;
  seg[tiff + 1] = littleEndian ? 0x49 : 0x4d;
  view.setUint16(tiff + 2, 0x002a, littleEndian);
  view.setUint32(tiff + 4, 8, littleEndian); // IFD0 starts at tiff + 8

  const ifd0 = tiff + 8;
  view.setUint16(ifd0, 2, littleEndian); // 2 entries

  // Entry 0: Make/Dummy tag 0x010F (ASCII, count 4)
  view.setUint16(ifd0 + 2, 0x010f, littleEndian);
  view.setUint16(ifd0 + 4, 2, littleEndian);
  view.setUint32(ifd0 + 6, 4, littleEndian);
  view.setUint32(ifd0 + 10, 0, littleEndian);

  // Entry 1: Orientation tag 0x0112 (SHORT, count 1, value = orientation)
  view.setUint16(ifd0 + 14, 0x0112, littleEndian);
  view.setUint16(ifd0 + 16, 3, littleEndian);
  view.setUint32(ifd0 + 18, 1, littleEndian);
  view.setUint16(ifd0 + 22, orientation, littleEndian);

  // Next IFD offset = 0
  view.setUint32(ifd0 + 26, 0, littleEndian);
  return seg;
}

function injectSegmentsAfterSoi(jpegBytes, segments) {
  const extraLen = segments.reduce((sum, s) => sum + s.length, 0);
  const out = new Uint8Array(jpegBytes.length + extraLen);
  out.set(jpegBytes.subarray(0, 2), 0); // SOI 0xFF 0xD8
  let offset = 2;
  for (const seg of segments) {
    out.set(seg, offset);
    offset += seg.length;
  }
  out.set(jpegBytes.subarray(2), offset);
  return out;
}

function getPixelRgb(buf, x, y) {
  const idx = (y * buf.width + x) * 4;
  return [buf.data[idx], buf.data[idx + 1], buf.data[idx + 2]];
}

function createQuadrantTestBuffer(width, height) {
  const buf = createSolidRgba(width, height, 0, 0, 0);
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (y < midY && x < midX) {
        // Top-Left: Red
        buf.data[idx] = 240;
        buf.data[idx + 1] = 20;
        buf.data[idx + 2] = 20;
      } else if (y < midY && x >= midX) {
        // Top-Right: Green
        buf.data[idx] = 20;
        buf.data[idx + 1] = 240;
        buf.data[idx + 2] = 20;
      } else if (y >= midY && x < midX) {
        // Bottom-Left: Blue
        buf.data[idx] = 20;
        buf.data[idx + 1] = 20;
        buf.data[idx + 2] = 240;
      } else {
        // Bottom-Right: Yellow
        buf.data[idx] = 240;
        buf.data[idx + 1] = 240;
        buf.data[idx + 2] = 20;
      }
      buf.data[idx + 3] = 255;
    }
  }
  return buf;
}

function dominantChannel(rgb) {
  const [r, g, b] = rgb;
  if (r > 180 && g > 180 && b < 80) return "Y";
  if (r > 180 && g < 80 && b < 80) return "R";
  if (g > 180 && r < 80 && b < 80) return "G";
  if (b > 180 && r < 80 && g < 80) return "B";
  return `?(${r},${g},${b})`;
}

test("readJpegExifOrientation handles missing, malformed, and both endiannesses", () => {
  assert.equal(cjsCore.readJpegExifOrientation(new Uint8Array([1, 2, 3])), 1);

  const img = createSolidRgba(16, 16, 100, 100, 100);
  const plainJpeg = jpeg.encode(img, 90).data;
  assert.equal(cjsCore.readJpegExifOrientation(plainJpeg), 1);

  // Non-Exif APP1 (e.g. XMP) followed by Big-Endian Exif APP1
  const xmpSeg = new Uint8Array([0xff, 0xe1, 0x00, 0x06, 0x58, 0x4d, 0x50, 0x00]);
  const withBeExif = injectSegmentsAfterSoi(plainJpeg, [
    xmpSeg,
    buildExifApp1Segment(6, false),
  ]);
  assert.equal(cjsCore.readJpegExifOrientation(withBeExif), 6);

  const withLeExif = injectSegmentsAfterSoi(plainJpeg, [
    buildExifApp1Segment(8, true),
  ]);
  assert.equal(cjsCore.readJpegExifOrientation(withLeExif), 8);
});

test("decodeJpegBytesToRgba applies all EXIF orientations 1..8 accurately", () => {
  // Raw image (32x16):
  // TL = Red, TR = Green
  // BL = Blue, BR = Yellow
  const rawW = 32;
  const rawH = 16;
  const raw = createQuadrantTestBuffer(rawW, rawH);
  const rawJpeg = jpeg.encode(raw, 95).data;

  const expected = [
    // [orientation, width, height, TL, TR, BL, BR]
    [1, 32, 16, "R", "G", "B", "Y"],
    [2, 32, 16, "G", "R", "Y", "B"],
    [3, 32, 16, "Y", "B", "G", "R"],
    [4, 32, 16, "B", "Y", "R", "G"],
    [5, 16, 32, "R", "B", "G", "Y"],
    [6, 16, 32, "B", "R", "Y", "G"],
    [7, 16, 32, "Y", "G", "B", "R"],
    [8, 16, 32, "G", "Y", "R", "B"],
  ];

  for (const [orientation, expW, expH, expTL, expTR, expBL, expBR] of expected) {
    const littleEndian = orientation % 2 === 1;
    const withExif = injectSegmentsAfterSoi(rawJpeg, [
      buildExifApp1Segment(orientation, littleEndian),
    ]);
    const decoded = cjsCore.decodeJpegBytesToRgba(withExif);

    assert.equal(decoded.width, expW, `width mismatch for orientation ${orientation}`);
    assert.equal(decoded.height, expH, `height mismatch for orientation ${orientation}`);

    const sampleMargin = 4;
    const tl = dominantChannel(getPixelRgb(decoded, sampleMargin, sampleMargin));
    const tr = dominantChannel(getPixelRgb(decoded, expW - 1 - sampleMargin, sampleMargin));
    const bl = dominantChannel(getPixelRgb(decoded, sampleMargin, expH - 1 - sampleMargin));
    const br = dominantChannel(
      getPixelRgb(decoded, expW - 1 - sampleMargin, expH - 1 - sampleMargin),
    );

    assert.deepEqual(
      [tl, tr, bl, br],
      [expTL, expTR, expBL, expBR],
      `quadrants mismatch for orientation ${orientation}`,
    );
  }
});

test("extractImagePage aligns portrait framing and clipped edges for EXIF-rotated landscape JPEGs", async () => {
  // Raw landscape 240x160 with document clipped along the raw TOP edge (y = 0..130, x = 35..205).
  // With EXIF Orientation = 6 (90° CW), visual image is portrait 160x240 and the clipped edge is RIGHT.
  const raw = createFramedBuffer(240, 160, [32, 32, 32]);
  drawDocumentRect(raw, 35, 0, 205, 130, [245, 245, 245]);

  const rawJpeg = jpeg.encode(raw, 95).data;
  const rotatedJpeg = injectSegmentsAfterSoi(rawJpeg, [
    buildExifApp1Segment(6, true),
  ]);
  const base64 = cjsCore.uint8ArrayToBase64(rotatedJpeg);

  const page = await cjsPdf.extractImagePage({
    uri: "file:///galaxy-s22-photo.jpg",
    base64,
  });

  assert.equal(page.width, 160);
  assert.equal(page.height, 240);

  const framing = cjsCore.analyzeDocumentFraming(page.rgba, "id-card");
  assert.ok(framing.metrics.clippedEdges.includes("right"));
  assert.ok(!framing.metrics.clippedEdges.includes("top"));
  assert.ok(framing.metrics.boundingBox);
  assert.ok(framing.metrics.boundingBox.x > 0.15);
  assert.ok(
    framing.metrics.boundingBox.x + framing.metrics.boundingBox.width > 0.95,
  );

  // Also verify data URI path + resizeRgbaIfNeeded receives EXIF-rotated portrait dimensions.
  const resizedPage = await cjsPdf.extractImagePage(
    { uri: `data:image/jpeg;base64,${base64}` },
    120,
  );
  assert.equal(resizedPage.width, 80);
  assert.equal(resizedPage.height, 120);
});
