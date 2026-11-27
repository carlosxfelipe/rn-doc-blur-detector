import {
  analyzeDocumentFraming,
  type DocumentFramingConfig,
  type DocumentFramingProfile,
  type DocumentFramingResult,
  resolveFramingConfig,
} from "./document-framing";

/**
 * Pure TypeScript Document Blur Detector using Global Laplacian Variance.
 *
 * Zero React, Expo, React Native, or DOM dependencies — works in Expo,
 * bare React Native, Web, and Node.js.
 */

export interface RgbaImageBuffer {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type BlurStatus = "sharp" | "borderline" | "blurry" | "insufficient";

export type BlurLocale = "pt-BR" | "en";

export interface BlurAnalysisMessages {
  insufficientLabel: string;
  insufficientReason: string;
  blurryLabel: string;
  blurryReason: string;
  borderlineLabel: string;
  borderlineReason: string;
  sharpLabel: string;
  sharpReason: string;
  summaryNoPagesLabel: string;
  summaryBlurrySingleLabel: string;
  summaryBlurryMultiPrefix: string;
  summaryBorderlineSingleLabel: string;
  summaryBorderlineMultiPrefix: string;
  summaryPagePrefix: string;
}

export interface LaplacianBlurConfig {
  maxAnalysisDim: number;
  sharpScoreThreshold: number;
  blurScoreThreshold: number;
  laplacianRef: number;
  globalRefFactor: number;
  minContentContrast: number;
  minContentStdDev: number;
  locale?: BlurLocale;
  messages?: Partial<BlurAnalysisMessages>;
  /** Optional document framing evaluation (`"off" | "auto" | "a4" | "id-card"` or full config). */
  framing?: DocumentFramingProfile | Partial<DocumentFramingConfig>;
}

export interface BlurAnalysisMetrics {
  globalLaplacianVar: number;
  analyzedWidth: number;
  analyzedHeight: number;
  elapsedMs: number;
}

export interface BlurAnalysisResult {
  status: BlurStatus;
  label: string;
  reason: string;
  score: number;
  metrics: BlurAnalysisMetrics;
  framing?: DocumentFramingResult;
}

export interface DocumentSummaryResult {
  status: BlurStatus;
  label: string;
  score: number;
  affectedPages: number[];
}

export const BLUR_MESSAGES_BY_LOCALE: Record<BlurLocale, BlurAnalysisMessages> =
  {
    "pt-BR": {
      insufficientLabel: "Conteúdo Insuficiente",
      insufficientReason:
        "Página em branco ou sem contraste suficiente para avaliar nitidez.",
      blurryLabel: "Documento Borrado",
      blurryReason:
        "As bordas e o texto estão suaves ou fora de foco. Tente capturar outra imagem.",
      borderlineLabel: "Atenção (Levemente Borrado)",
      borderlineReason:
        "Nitidez limítrofe. Recomenda-se capturar o documento novamente para maior clareza.",
      sharpLabel: "Documento Nítido",
      sharpReason: "Bordas definidas e bom foco em todo o documento.",
      summaryNoPagesLabel: "Sem Páginas",
      summaryBlurrySingleLabel: "Documento Borrado",
      summaryBlurryMultiPrefix: "Borrado",
      summaryBorderlineSingleLabel: "Levemente Borrado",
      summaryBorderlineMultiPrefix: "Atenção",
      summaryPagePrefix: "Pág.",
    },
    en: {
      insufficientLabel: "Insufficient Content",
      insufficientReason:
        "Blank page or insufficient contrast to evaluate sharpness.",
      blurryLabel: "Blurry Document",
      blurryReason:
        "Edges and text look soft or out of focus. Try capturing another image.",
      borderlineLabel: "Warning (Slightly Blurry)",
      borderlineReason:
        "Borderline sharpness. Consider recapturing the document for better clarity.",
      sharpLabel: "Sharp Document",
      sharpReason: "Crisp edges and good focus across the document.",
      summaryNoPagesLabel: "No Pages",
      summaryBlurrySingleLabel: "Blurry Document",
      summaryBlurryMultiPrefix: "Blurry",
      summaryBorderlineSingleLabel: "Slightly Blurry",
      summaryBorderlineMultiPrefix: "Warning",
      summaryPagePrefix: "Page",
    },
  };

export const DEFAULT_LAPLACIAN_CONFIG: LaplacianBlurConfig = {
  maxAnalysisDim: 1400,
  sharpScoreThreshold: 60,
  blurScoreThreshold: 40,
  laplacianRef: 650,
  globalRefFactor: 0.45,
  minContentContrast: 24,
  minContentStdDev: 5.5,
  locale: "pt-BR",
};

function nowMs(): number {
  const perf = (globalThis as { performance?: { now: () => number } })
    .performance;
  return perf ? perf.now() : Date.now();
}

function resolveMessages(
  locale: BlurLocale = "pt-BR",
  overrides?: Partial<BlurAnalysisMessages>,
): BlurAnalysisMessages {
  return {
    ...BLUR_MESSAGES_BY_LOCALE[locale],
    ...overrides,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeHigherBetter(value: number, ref: number): number {
  if (value <= 0 || ref <= 0) return 0;
  const ratio = value / ref;
  return clamp01(1 - Math.exp(-1.2 * ratio)) * 100;
}

/**
 * Downsamples an RGBA buffer with box averaging when its longest edge exceeds `maxDim`.
 */
export function resizeRgbaIfNeeded(
  image: RgbaImageBuffer,
  maxDim: number,
): RgbaImageBuffer {
  const { width, height, data } = image;
  const longest = Math.max(width, height);
  if (!maxDim || longest <= maxDim) {
    return image;
  }

  const scale = maxDim / longest;
  const newW = Math.max(16, Math.round(width * scale));
  const newH = Math.max(16, Math.round(height * scale));
  const out = new Uint8ClampedArray(newW * newH * 4);

  const xRatio = width / newW;
  const yRatio = height / newH;

  for (let ny = 0; ny < newH; ny++) {
    const sy0 = Math.floor(ny * yRatio);
    const sy1 = Math.min(
      height,
      Math.max(sy0 + 1, Math.floor((ny + 1) * yRatio)),
    );

    for (let nx = 0; nx < newW; nx++) {
      const sx0 = Math.floor(nx * xRatio);
      const sx1 = Math.min(
        width,
        Math.max(sx0 + 1, Math.floor((nx + 1) * xRatio)),
      );

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = sy0; sy < sy1; sy++) {
        const rowOffset = sy * width * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = rowOffset + sx * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          a += data[idx + 3];
          count++;
        }
      }

      const outIdx = (ny * newW + nx) * 4;
      out[outIdx] = r / count;
      out[outIdx + 1] = g / count;
      out[outIdx + 2] = b / count;
      out[outIdx + 3] = a / count;
    }
  }

  return { width: newW, height: newH, data: out };
}

/**
 * Converts RGBA pixels to grayscale luminance (0..255), compositing alpha over white paper.
 */
export function toGrayscaleLuminance(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): {
  lum: Float32Array;
  contrast: number;
  stdDev: number;
} {
  const totalPixels = width * height;
  const lum = new Float32Array(totalPixels);
  let minLum = 255;
  let maxLum = 0;
  let lumSum = 0;
  let lumSqSum = 0;

  for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
    const alpha = data[p + 3] / 255;
    const r = data[p] * alpha + 255 * (1 - alpha);
    const g = data[p + 1] * alpha + 255 * (1 - alpha);
    const b = data[p + 2] * alpha + 255 * (1 - alpha);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;

    lum[i] = y;
    if (y < minLum) minLum = y;
    if (y > maxLum) maxLum = y;
    lumSum += y;
    lumSqSum += y * y;
  }

  const mean = totalPixels > 0 ? lumSum / totalPixels : 0;
  const variance =
    totalPixels > 0 ? Math.max(0, lumSqSum / totalPixels - mean * mean) : 0;

  return {
    lum,
    contrast: totalPixels > 0 ? maxLum - minLum : 0,
    stdDev: Math.sqrt(variance),
  };
}

function computeLaplacianMetricsFromLuminance(
  lum: ArrayLike<number>,
  width: number,
  height: number,
  contrast: number,
  stdDev: number,
  cfg: LaplacianBlurConfig,
  t0: number,
): BlurAnalysisResult {
  const messages = resolveMessages(cfg.locale, cfg.messages);

  let lapSum = 0;
  let lapSqSum = 0;
  let innerCount = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    const rowUp = (y - 1) * width;
    const rowDn = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap =
        4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[rowUp + x] - lum[rowDn + x];
      lapSum += lap;
      lapSqSum += lap * lap;
      innerCount++;
    }
  }

  const lapMean = innerCount > 0 ? lapSum / innerCount : 0;
  const globalLaplacianVar =
    innerCount > 0 ? Math.max(0, lapSqSum / innerCount - lapMean * lapMean) : 0;

  const elapsedMs = nowMs() - t0;

  const roundedVar = Math.round(globalLaplacianVar * 10) / 10;
  const roundedElapsed = Math.round(elapsedMs * 10) / 10;
  const metrics: BlurAnalysisMetrics = {
    globalLaplacianVar: roundedVar,
    analyzedWidth: width,
    analyzedHeight: height,
    elapsedMs: roundedElapsed,
  };

  if (
    innerCount === 0 ||
    contrast < cfg.minContentContrast ||
    stdDev < cfg.minContentStdDev
  ) {
    return {
      status: "insufficient",
      label: messages.insufficientLabel,
      reason: messages.insufficientReason,
      score: 0,
      metrics,
    };
  }

  const rawScore = normalizeHigherBetter(
    globalLaplacianVar,
    cfg.laplacianRef * cfg.globalRefFactor,
  );
  const score = Math.round(rawScore);

  if (rawScore < cfg.blurScoreThreshold) {
    return {
      status: "blurry",
      label: messages.blurryLabel,
      reason: messages.blurryReason,
      score,
      metrics,
    };
  }

  if (rawScore < cfg.sharpScoreThreshold) {
    return {
      status: "borderline",
      label: messages.borderlineLabel,
      reason: messages.borderlineReason,
      score,
      metrics,
    };
  }

  return {
    status: "sharp",
    label: messages.sharpLabel,
    reason: messages.sharpReason,
    score,
    metrics,
  };
}

/**
 * Computes sharpness directly from a grayscale luminance buffer (`0..255` per pixel),
 * avoiding RGBA conversion overhead (e.g. Y-plane from camera frame processors).
 */
export function analyzeLuminanceBlur(
  lum: ArrayLike<number>,
  width: number,
  height: number,
  userConfig: Partial<LaplacianBlurConfig> = {},
): BlurAnalysisResult {
  const cfg: LaplacianBlurConfig = {
    ...DEFAULT_LAPLACIAN_CONFIG,
    ...userConfig,
  };
  const t0 = nowMs();
  const totalPixels = width * height;

  if (width <= 0 || height <= 0 || lum.length < totalPixels) {
    return computeLaplacianMetricsFromLuminance([], 0, 0, 0, 0, cfg, t0);
  }

  let minLum = 255;
  let maxLum = 0;
  let lumSum = 0;
  let lumSqSum = 0;

  for (let i = 0; i < totalPixels; i++) {
    const y = lum[i];
    if (y < minLum) minLum = y;
    if (y > maxLum) maxLum = y;
    lumSum += y;
    lumSqSum += y * y;
  }

  const mean = totalPixels > 0 ? lumSum / totalPixels : 0;
  const variance =
    totalPixels > 0 ? Math.max(0, lumSqSum / totalPixels - mean * mean) : 0;

  return computeLaplacianMetricsFromLuminance(
    lum,
    width,
    height,
    totalPixels > 0 ? maxLum - minLum : 0,
    Math.sqrt(variance),
    cfg,
    t0,
  );
}

/**
 * Computes sharpness using Global Classic Laplacian Variance (4-neighbor kernel).
 */
export function analyzeGlobalLaplacianBlur(
  image: RgbaImageBuffer,
  userConfig: Partial<LaplacianBlurConfig> = {},
): BlurAnalysisResult {
  const cfg: LaplacianBlurConfig = {
    ...DEFAULT_LAPLACIAN_CONFIG,
    ...userConfig,
  };
  const t0 = nowMs();

  if (
    image.width <= 0 ||
    image.height <= 0 ||
    image.data.length < image.width * image.height * 4
  ) {
    return computeLaplacianMetricsFromLuminance([], 0, 0, 0, 0, cfg, t0);
  }

  const prepared = resizeRgbaIfNeeded(image, cfg.maxAnalysisDim);
  const { width, height, data } = prepared;
  const { lum, contrast, stdDev } = toGrayscaleLuminance(data, width, height);

  const result = computeLaplacianMetricsFromLuminance(
    lum,
    width,
    height,
    contrast,
    stdDev,
    cfg,
    t0,
  );

  if (cfg.framing) {
    const resolvedFraming = resolveFramingConfig(cfg.framing, cfg.locale);
    if (resolvedFraming.profile !== "off") {
      result.framing = analyzeDocumentFraming(image, resolvedFraming);
    }
  }

  return result;
}

/**
 * Aggregates per-page blur results into an overall document verdict.
 */
export function aggregateDocumentResults(
  pageResults: readonly BlurAnalysisResult[],
  options: {
    locale?: BlurLocale;
    messages?: Partial<BlurAnalysisMessages>;
  } = {},
): DocumentSummaryResult {
  const messages = resolveMessages(options.locale, options.messages);

  if (pageResults.length === 0) {
    return {
      status: "insufficient",
      label: messages.summaryNoPagesLabel,
      score: 0,
      affectedPages: [],
    };
  }

  const blurryPages: number[] = [];
  const borderlinePages: number[] = [];
  let minScore = Infinity;

  pageResults.forEach((result, index) => {
    const pageNumber = index + 1;
    if (result.status !== "insufficient" && result.score < minScore) {
      minScore = result.score;
    }
    if (result.status === "blurry") {
      blurryPages.push(pageNumber);
    } else if (result.status === "borderline") {
      borderlinePages.push(pageNumber);
    }
  });

  if (minScore === Infinity) {
    minScore = 0;
  }

  if (blurryPages.length > 0) {
    return {
      status: "blurry",
      label:
        pageResults.length > 1
          ? `${messages.summaryBlurryMultiPrefix} (${messages.summaryPagePrefix} ${blurryPages.join(", ")})`
          : messages.summaryBlurrySingleLabel,
      score: minScore,
      affectedPages: blurryPages,
    };
  }

  if (borderlinePages.length > 0) {
    return {
      status: "borderline",
      label:
        pageResults.length > 1
          ? `${messages.summaryBorderlineMultiPrefix} (${messages.summaryPagePrefix} ${borderlinePages.join(", ")})`
          : messages.summaryBorderlineSingleLabel,
      score: minScore,
      affectedPages: borderlinePages,
    };
  }

  if (pageResults.every((result) => result.status === "insufficient")) {
    return {
      status: "insufficient",
      label: messages.insufficientLabel,
      score: 0,
      affectedPages: [],
    };
  }

  return {
    status: "sharp",
    label: messages.sharpLabel,
    score: minScore,
    affectedPages: [],
  };
}
