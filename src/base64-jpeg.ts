import jpeg from "jpeg-js";

import {
  analyzeGlobalLaplacianBlur,
  type BlurAnalysisResult,
  type LaplacianBlurConfig,
  type RgbaImageBuffer,
} from "./laplacian-blur-detector";

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    table[BASE64_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

const WHITESPACE_RE = /\s/;

/**
 * Decodes a base64 string (or data URI) into a Uint8Array without Node `Buffer`.
 */
export function base64ToUint8Array(input: string): Uint8Array {
  const commaIdx = input.indexOf(",");
  const raw = commaIdx !== -1 ? input.slice(commaIdx + 1) : input;
  const cleaned = WHITESPACE_RE.test(raw) ? raw.replace(/\s+/g, "") : raw;

  let padding = 0;
  if (cleaned.endsWith("==")) padding = 2;
  else if (cleaned.endsWith("=")) padding = 1;

  const byteLength = Math.max(
    0,
    Math.floor((cleaned.length * 3) / 4) - padding,
  );
  const bytes = new Uint8Array(byteLength);

  let outIdx = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const c1 = BASE64_LOOKUP[cleaned.charCodeAt(i)] ?? 0;
    const c2 = BASE64_LOOKUP[cleaned.charCodeAt(i + 1)] ?? 0;
    const c3 = BASE64_LOOKUP[cleaned.charCodeAt(i + 2)];
    const c4 = BASE64_LOOKUP[cleaned.charCodeAt(i + 3)];

    const n =
      (c1 << 18) | (c2 << 12) | ((c3 >= 0 ? c3 : 0) << 6) | (c4 >= 0 ? c4 : 0);

    if (outIdx < byteLength) bytes[outIdx++] = (n >> 16) & 0xff;
    if (outIdx < byteLength && c3 >= 0) bytes[outIdx++] = (n >> 8) & 0xff;
    if (outIdx < byteLength && c4 >= 0) bytes[outIdx++] = n & 0xff;
  }

  return bytes;
}

/**
 * Encodes a Uint8Array into a standard base64 string without Node `Buffer`.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;

    const triplet = (b0 << 16) | (b1 << 8) | b2;

    parts.push(
      BASE64_CHARS[(triplet >> 18) & 0x3f],
      BASE64_CHARS[(triplet >> 12) & 0x3f],
      hasB1 ? BASE64_CHARS[(triplet >> 6) & 0x3f] : "=",
      hasB2 ? BASE64_CHARS[triplet & 0x3f] : "=",
    );
  }

  return parts.join("");
}

/**
 * Checks whether a byte buffer starts with a valid JPEG SOI marker (0xFF 0xD8).
 */
export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Decodes raw JPEG bytes into an RGBA pixel buffer using pure JS (`jpeg-js`).
 */
export function decodeJpegBytesToRgba(bytes: Uint8Array): RgbaImageBuffer {
  if (!isJpegBytes(bytes)) {
    throw new Error("Invalid or empty JPEG payload.");
  }

  const decoded = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
  });

  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
  };
}

/**
 * Decodes a JPEG base64 payload (or data URI) into an RGBA pixel buffer using pure JS.
 */
export function decodeJpegBase64ToRgba(base64: string): RgbaImageBuffer {
  return decodeJpegBytesToRgba(base64ToUint8Array(base64));
}

/**
 * Decodes raw JPEG bytes and runs Global Laplacian blur analysis.
 */
export function analyzeJpegBytesBlur(
  bytes: Uint8Array,
  config?: Partial<LaplacianBlurConfig>,
): BlurAnalysisResult {
  const rgba = decodeJpegBytesToRgba(bytes);
  return analyzeGlobalLaplacianBlur(rgba, config);
}

/**
 * Decodes a JPEG base64 payload (or data URI) and runs Global Laplacian blur analysis.
 */
export function analyzeJpegBase64Blur(
  base64: string,
  config?: Partial<LaplacianBlurConfig>,
): BlurAnalysisResult {
  const rgba = decodeJpegBase64ToRgba(base64);
  return analyzeGlobalLaplacianBlur(rgba, config);
}
