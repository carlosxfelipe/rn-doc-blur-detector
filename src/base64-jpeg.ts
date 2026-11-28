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
 * EXIF Orientation tag (`0x0112`) values (`1..8`).
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const EXIF_HEADER_BYTES = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] as const;

function readUint16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number {
  return (
    (littleEndian
      ? bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
      : (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>> 0
  );
}

function parseTiffExifOrientation(
  bytes: Uint8Array,
  tiffStart: number,
  tiffEnd: number,
): ExifOrientation | null {
  if (tiffStart + 8 > tiffEnd) {
    return null;
  }

  const b0 = bytes[tiffStart];
  const b1 = bytes[tiffStart + 1];
  let littleEndian: boolean;
  if (b0 === 0x49 && b1 === 0x49) {
    littleEndian = true;
  } else if (b0 === 0x4d && b1 === 0x4d) {
    littleEndian = false;
  } else {
    return null;
  }

  if (readUint16(bytes, tiffStart + 2, littleEndian) !== 0x002a) {
    return null;
  }

  const ifd0Offset = tiffStart + readUint32(bytes, tiffStart + 4, littleEndian);
  if (ifd0Offset < tiffStart || ifd0Offset + 2 > tiffEnd) {
    return null;
  }

  const entryCount = readUint16(bytes, ifd0Offset, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > tiffEnd) {
      break;
    }

    const tag = readUint16(bytes, entryOffset, littleEndian);
    if (tag !== 0x0112) {
      continue;
    }

    const type = readUint16(bytes, entryOffset + 2, littleEndian);
    const count = readUint32(bytes, entryOffset + 4, littleEndian);
    if (count < 1) {
      return null;
    }

    let value: number;
    if (type === 3) {
      value = readUint16(bytes, entryOffset + 8, littleEndian);
    } else if (type === 4) {
      value = readUint32(bytes, entryOffset + 8, littleEndian);
    } else {
      return null;
    }

    return value >= 1 && value <= 8 ? (value as ExifOrientation) : null;
  }

  return null;
}

function hasExifSignature(bytes: Uint8Array, offset: number): boolean {
  for (let i = 0; i < EXIF_HEADER_BYTES.length; i++) {
    if (bytes[offset + i] !== EXIF_HEADER_BYTES[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Reads the EXIF `Orientation` tag (`0x0112`) from raw JPEG bytes.
 * Returns `1` (normal) if missing, invalid, or non-JPEG.
 */
export function readJpegExifOrientation(bytes: Uint8Array): ExifOrientation {
  if (!isJpegBytes(bytes)) {
    return 1;
  }

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset++;
    }
    if (offset >= bytes.length) {
      break;
    }

    const marker = bytes[offset++];
    // Stop at Start of Scan (0xDA) or End of Image (0xD9); metadata lives before scan data.
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      break;
    }
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    if (marker === 0xe1) {
      const payloadStart = offset + 2;
      const segmentEnd = offset + segmentLength;
      if (
        payloadStart + EXIF_HEADER_BYTES.length <= segmentEnd &&
        hasExifSignature(bytes, payloadStart)
      ) {
        const orientation = parseTiffExifOrientation(
          bytes,
          payloadStart + EXIF_HEADER_BYTES.length,
          segmentEnd,
        );
        if (orientation !== null) {
          return orientation;
        }
      }
    }

    offset += segmentLength;
  }

  return 1;
}

/**
 * Applies an EXIF `Orientation` (`1..8`) transformation to an RGBA image buffer,
 * rotating and/or mirroring pixels and swapping dimensions for orientations `5..8`.
 */
export function applyExifOrientation(
  image: RgbaImageBuffer,
  orientation: ExifOrientation,
): RgbaImageBuffer {
  const { width, height, data } = image;
  if (
    orientation === 1 ||
    width <= 0 ||
    height <= 0 ||
    data.length < width * height * 4
  ) {
    return image;
  }

  const swapAxes = orientation >= 5;
  const outWidth = swapAxes ? height : width;
  const outHeight = swapAxes ? width : height;
  const outLength = outWidth * outHeight * 4;
  const outData =
    data instanceof Uint8ClampedArray
      ? new Uint8ClampedArray(outLength)
      : new Uint8Array(outLength);

  // Linear destination pixel mapping: dstPixel = baseOffset + sy * rowStride + sx * colStride
  let baseOffset: number;
  let rowStride: number;
  let colStride: number;

  switch (orientation) {
    case 2:
      baseOffset = width - 1;
      rowStride = outWidth;
      colStride = -1;
      break;
    case 3:
      baseOffset = outWidth * outHeight - 1;
      rowStride = -outWidth;
      colStride = -1;
      break;
    case 4:
      baseOffset = (height - 1) * outWidth;
      rowStride = -outWidth;
      colStride = 1;
      break;
    case 5:
      baseOffset = 0;
      rowStride = 1;
      colStride = outWidth;
      break;
    case 6:
      baseOffset = height - 1;
      rowStride = -1;
      colStride = outWidth;
      break;
    case 7:
      baseOffset = outWidth * outHeight - 1;
      rowStride = -1;
      colStride = -outWidth;
      break;
    case 8:
      baseOffset = (width - 1) * outWidth;
      rowStride = 1;
      colStride = -outWidth;
      break;
  }

  const rowByteStride = rowStride * 4;
  const colByteStride = colStride * 4;
  let dstRowStart = baseOffset * 4;
  let srcIdx = 0;

  for (let sy = 0; sy < height; sy++) {
    let dstIdx = dstRowStart;
    for (let sx = 0; sx < width; sx++) {
      outData[dstIdx] = data[srcIdx];
      outData[dstIdx + 1] = data[srcIdx + 1];
      outData[dstIdx + 2] = data[srcIdx + 2];
      outData[dstIdx + 3] = data[srcIdx + 3];
      srcIdx += 4;
      dstIdx += colByteStride;
    }
    dstRowStart += rowByteStride;
  }

  return {
    width: outWidth,
    height: outHeight,
    data: outData,
  };
}

/**
 * Decodes raw JPEG bytes into an RGBA pixel buffer using pure JS (`jpeg-js`),
 * applying any EXIF `Orientation` transform so pixels match upright display.
 */
export function decodeJpegBytesToRgba(bytes: Uint8Array): RgbaImageBuffer {
  if (!isJpegBytes(bytes)) {
    throw new Error("Invalid or empty JPEG payload.");
  }

  const orientation = readJpegExifOrientation(bytes);
  const decoded = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
  });

  return applyExifOrientation(
    {
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    },
    orientation,
  );
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
