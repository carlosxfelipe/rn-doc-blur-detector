# rn-doc-blur-detector

Pure TypeScript/JavaScript core for client-side document and image blur detection (**Global Laplacian Variance**) and **document framing evaluation**, compatible with any **React Native (Expo or Bare RN)**, **Web**, and **Node.js** project.

Zero `.tsx` files, zero coupled UI, and zero `expo-*` dependencies.

## Entry Points

| Import                     | Contents                                                                                                                                                                                         |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rn-doc-blur-detector`     | Laplacian blur detection engine, document framing evaluator (`analyzeDocumentFraming`), and pure JS JPEG/Base64 decoder (`jpeg-js`)                                                              |
| `rn-doc-blur-detector/pdf` | Cross-platform PDF and image extraction (`iOS/Android/Web`), `PDF_WEBVIEW_HTML` (vendored offline `pdfjs-dist@4.10.38` on iOS/Android), `createPdfBridgeController()`, and document/file helpers |

## Installation

Install directly from GitHub (`prepare` automatically builds `lib/` during Git installs on npm/Yarn/pnpm):

```bash
npm install github:carlosxfelipe/rn-doc-blur-detector
```

Or generate a local tarball with `npm run tarball` and install the `.tgz` file directly in your project.

> - If you plan to render PDFs on iOS/Android via `rn-doc-blur-detector/pdf`, also install `react-native-webview` in your host app (and run `cd ios && pod install` on Bare React Native iOS).
> - When installing directly from GitHub with **Bun**, allow lifecycle scripts for `rn-doc-blur-detector` (via `trustedDependencies`) or install from a `.tgz` tarball so `lib/` is available.

---

## Usage

### 1. Core Engine (RGBA, Grayscale Luminance, or JPEG Base64)

Works everywhere (Expo, Bare React Native, Web, Node.js):

```ts
import {
  analyzeDocumentFraming,
  analyzeGlobalLaplacianBlur,
  analyzeJpegBase64Blur,
  analyzeLuminanceBlur,
} from "rn-doc-blur-detector";

// From a raw RGBA pixel buffer (Canvas, Skia, etc.)
const rgbaResult = analyzeGlobalLaplacianBlur(
  {
    width: 1200,
    height: 1600,
    data: rgbaUint8Array,
  },
  {
    locale: "en", // "en" or "pt-BR" (default: "pt-BR"), or pass custom `messages`
    framing: "auto", // optional: "off" | "auto" | "a4" | "id-card" | Partial<DocumentFramingConfig>
  },
);

// Or evaluate document framing directly (area coverage, clipped edges, skew, aspect ratio)
const framingResult = analyzeDocumentFraming(
  {
    width: 1200,
    height: 1600,
    data: rgbaUint8Array,
  },
  "id-card",
);

// Directly from a grayscale luminance buffer (e.g. Y-plane from VisionCamera Frame Processors)
const lumResult = analyzeLuminanceBlur(yPlane, 1200, 1600, { locale: "en" });

// From a JPEG Base64 string (e.g. react-native-image-picker with includeBase64: true)
const jpegResult = analyzeJpegBase64Blur(jpegBase64, { locale: "en" });
```

### 2. Images & Multi-page PDFs (`rn-doc-blur-detector/pdf`)

#### Images

`analyzeImage` (or `extractImagePage`) decodes a JPEG `uri` or `base64` payload into RGBA and runs Laplacian analysis:

```ts
import { analyzeImage } from "rn-doc-blur-detector/pdf";

const { analysis, page } = await analyzeImage(
  { uri: imageUri, base64: optionalJpegBase64 },
  {
    framing: "id-card", // optional: "off" | "auto" | "a4" | "id-card" | Partial<DocumentFramingConfig>
    config: { locale: "en" },
  },
);

// `analysis.framing` is populated when `framing` is set and not `"off"`
console.log(
  analysis.status,
  analysis.framing?.status,
  analysis.framing?.metrics.boundingBox,
);
```

> On React Native, non-JPEG URIs without a `base64` payload (e.g. PNG/HEIC) require a custom `extractImageAdapter` option (for example using Skia, `@bam.tech/react-native-image-resizer`, or `expo-image-manipulator`). On Web, `HTMLCanvasElement` handles all browser-supported formats automatically.

#### PDFs on React Native (iOS & Android)

Mount a hidden `<WebView>` from `react-native-webview` wired to `PDF_WEBVIEW_HTML` and `createPdfBridgeController()`, then pass `runJob` into `analyzePdf` (or `extractPdfPages`):

```tsx
import { type ComponentType, type RefAttributes, useMemo, useRef } from "react";
import { View } from "react-native";
import WebView, {
  type WebViewMessageEvent,
  type WebViewProps,
} from "react-native-webview";
import {
  analyzePdf,
  createPdfBridgeController,
  PDF_WEBVIEW_HTML,
} from "rn-doc-blur-detector/pdf";

interface WebViewRefHandle {
  injectJavaScript: (script: string) => void;
}

// react-native-webview declares WebView as FunctionComponent<WebViewProps>,
// so cast it with RefAttributes for React 18/19 + TypeScript compatibility.
const TypedWebView = WebView as unknown as ComponentType<
  WebViewProps & RefAttributes<WebViewRefHandle>
>;

// Inside your component:
const webViewRef = useRef<WebViewRefHandle>(null);
const pdfBridge = useMemo(() => createPdfBridgeController(), []);

const analyzeSelectedPdf = async (pdfUri: string) => {
  return analyzePdf(
    { uri: pdfUri }, // or { uri: "", base64 }
    {
      maxPages: 2, // pass Infinity for all pages
      framing: "a4", // optional per-page framing check
      config: { locale: "en" },
      // Optional on iOS/Android: omit to use built-in fetch + FileReader for file:// and content:// URIs
      // readFileAsBase64: (uri) => ...,
      renderPdfViaBridge: (params) =>
        pdfBridge.runJob(params, (script) => {
          if (!webViewRef.current) {
            throw new Error("PDF WebView is not mounted.");
          }
          webViewRef.current.injectJavaScript(script);
        }),
    },
  );
};

// Render the hidden WebView in your JSX:
<View
  pointerEvents="none"
  style={{
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  }}
>
  <TypedWebView
    ref={webViewRef}
    source={{ html: PDF_WEBVIEW_HTML }}
    originWhitelist={["*"]}
    javaScriptEnabled
    onMessage={(e: WebViewMessageEvent) =>
      pdfBridge.handleMessage(e.nativeEvent.data)
    }
    style={{ width: 1, height: 1 }}
  />
</View>;
```

- **iOS & Android:** `PDF_WEBVIEW_HTML` automatically resolves `pdf-webview-html.native.js`, loading the vendored offline `pdfjs-dist@4.10.38` bundle via `Blob` URLs.
- **Web:** `extractImagePage` / `extractPdfPages` / `analyzePdf` use `HTMLCanvasElement` and `pdfjs-dist@4.10.38` via jsDelivr CDN (`renderPdfViaBridge` is ignored). If your app also targets Web, keep `react-native-webview` out of the Web bundle with a `.web.tsx` stub.
- **Full Bare RN example:** see [`rn-doc-blur-detector-demo`](https://github.com/carlosxfelipe/rn-doc-blur-detector-demo) for a complete React Native CLI app using `react-native-image-picker` and `@react-native-documents/picker`.

### 3. Document Helpers (`buildAnalyzedDocument`, `validateFileSize`, `isPdfAsset`, `isImageAsset`)

When using `extractImagePage` / `extractPdfPages` directly (for instance, to keep rendered page previews alongside scores), assemble the document summary and validate assets with the built-in helpers:

```ts
import {
  buildAnalyzedDocument,
  DEFAULT_MAX_FILE_SIZE_MB,
  extractPdfPages,
  isPdfAsset,
  validateFileSize,
} from "rn-doc-blur-detector/pdf";

const sizeCheck = validateFileSize(file.size, DEFAULT_MAX_FILE_SIZE_MB);
if (!sizeCheck.valid) {
  throw new Error(`File too large: ${sizeCheck.formattedSize}`);
}

const extractedPdf = await extractPdfPages(
  { uri: file.uri },
  { renderPdfViaBridge },
);

const analyzed = buildAnalyzedDocument(
  {
    id: `${Date.now()}`,
    name: file.name,
    type: isPdfAsset(file.name, file.mimeType) ? "pdf" : "image",
    size: file.size,
    totalPages: extractedPdf.totalPages,
    truncated: extractedPdf.truncated,
    pages: extractedPdf.pages,
  },
  { locale: "en" },
);
```

### 4. Document Framing (`framing` & `analyzeDocumentFraming`)

Evaluate whether a document (such as an **ID card / RG / CNH** or **A4 sheet / contract**) is properly framed without clipped edges, excessive tilt, or low area coverage.

#### Profiles

- `"off"`: disables framing evaluation (default when `framing` is omitted from `LaplacianBlurConfig`).
- `"auto"`: general rectangular documents (`minAreaCoverage: 0.25`, aspect ratio `1.12..2.05`).
- `"a4"`: A4 sheets and contracts (`minAreaCoverage: 0.35`, aspect ratio `1.18..1.72`).
- `"id-card"`: ID cards / CR80 / RG / CNH (`minAreaCoverage: 0.20`, aspect ratio `1.25..1.88`).

You can also pass a partial `DocumentFramingConfig` object to override `locale`, `maxAnalysisDim`, `minAreaCoverage`, `minEdgeMarginRatio`, `maxCenterOffsetRatio`, `maxSkewDegrees`, `minAspectRatio`, or `maxAspectRatio`.

#### Re-evaluating framing & drawing a preview overlay (as in `rn-doc-blur-detector-demo`)

When keeping extracted pages (`ExtractedDocumentPage[]`) in state, you can switch framing profiles instantaneously on `page.rgba` via `resolveFramingConfig` + `analyzeDocumentFraming` and render `metrics.boundingBox` over the preview `<Image>`:

```tsx
import { useMemo } from "react";
import { Image, View } from "react-native";
import {
  analyzeDocumentFraming,
  type DocumentFramingProfile,
  resolveFramingConfig,
} from "rn-doc-blur-detector";
import type { ExtractedDocumentPage } from "rn-doc-blur-detector/pdf";

// Inside your component, given `activePage: ExtractedDocumentPage` and `framing: DocumentFramingProfile`:
const resolvedFraming = useMemo(
  () => resolveFramingConfig(framing, "en"), // "en" or "pt-BR" (default: "pt-BR")
  [framing],
);

const framingResult = useMemo(() => {
  if (resolvedFraming.profile === "off") return null;
  return analyzeDocumentFraming(activePage.rgba, resolvedFraming);
}, [activePage.rgba, resolvedFraming]);

const box = framingResult?.metrics.boundingBox;

// Wrap the <Image> in a container matching the rendered image dimensions (width × height):
<View style={{ width: renderWidth, height: renderHeight }}>
  <Image
    source={{ uri: activePage.previewUri }}
    resizeMode="contain"
    style={{ width: "100%", height: "100%" }}
  />
  {framingResult && box && !framingResult.metrics.isFullPageScan ? (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
        borderWidth: 2,
        borderColor: framingResult.status === "good" ? "#15803D" : "#B91C1C",
        borderRadius: 4,
      }}
    />
  ) : null}
</View>;
```

> **Note:** `analyzeDocumentFraming` operates on RGB contrast and edge gradients in pure JS/TS with zero native dependencies, so it works best when there is visual contrast between the document and the background surface.

---

## Configuration & Limits

- **PDF Page Limit (`maxPages` & `targetMaxDim`):** Both `extractPdfPages` and `analyzePdf` default to `maxPages: 2` and `targetMaxDim: 1400` (`DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim`). Pass any number—or `Infinity` to process all pages.
- **File Size Limit (`validateFileSize`):** `extractImagePage`, `extractPdfPages`, `analyzeImage`, and `analyzePdf` do **not** hard-block files by size. Use `validateFileSize(sizeBytes, maxSizeMb)` (defaults to `DEFAULT_MAX_FILE_SIZE_MB = 9`, or pass `0` / `Infinity` to disable) for pre-flight checks.
- **WebView Controller Timeouts & Cancellation:** `createPdfBridgeController({ readyTimeoutMs, jobTimeoutMs })` defaults to `readyTimeoutMs: 10000` and `jobTimeoutMs: 30000`, and exposes `cancel(reason?)` and `reset()`.

> **Performance note:** On iOS/Android, each PDF page is rasterized in the hidden WebView and passed back as a JPEG Base64 string. Raising `maxPages` or processing very large PDFs increases memory usage and processing time proportionally.

---

## Classification & Thresholds

### Blur Status

- `insufficient`: blank page or insufficient contrast (`contrast < 24` or `stdDev < 5.5`)
- `blurry`: `score < 40`
- `borderline`: `40 <= score < 60`
- `sharp`: `score >= 60`

### Framing Status

- `insufficient`: invalid buffer, blank image, or insufficient contrast (`contrast < 20` or `stdDev < 4.5`)
- `poor`: document clipped at one or more edges (`clippedEdges.length > 0`), too far (`areaCoverage < minAreaCoverage * 0.78`), not detected, or `score < 55`
- `warning`: document tilted (`skewDegrees > maxSkewDegrees`), off-center (`centerOffset > maxCenterOffsetRatio`), unexpected aspect ratio for the selected profile, or `55 <= score < 80`
- `good`: well-framed document (`score >= 80`, no issues) or clean full-page scan/PDF (`isFullPageScan: true`) with matching aspect ratio

## Build, Test & Packaging

```bash
npm install          # also runs `prepare` -> `npm run build`
npm run typecheck
npm test
npm run pack:check   # preview package contents without creating a .tgz
npm run tarball      # typecheck, test, build, and generate the .tgz tarball
```

## License

This project is licensed under the [MIT License](LICENSE).

The PDF submodule (`rn-doc-blur-detector/pdf`) bundles [pdfjs-dist](https://github.com/mozilla/pdf.js) (`4.10.38`), licensed under the **Apache License 2.0** — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 **Carlos Felipe Araújo**.
