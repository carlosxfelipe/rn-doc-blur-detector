# rn-doc-blur-detector

Pure TypeScript/JavaScript core for client-side document and image blur detection (**Global Laplacian Variance**), compatible with any **React Native (Expo or Bare RN)**, **Web**, and **Node.js** project.

Zero `.tsx` files, zero coupled UI, and zero `expo-*` dependencies.

## Entry Points

| Import                     | Contents                                                                                                                                                                                         |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rn-doc-blur-detector`     | Laplacian blur detection engine + pure JS JPEG/Base64 decoder (`jpeg-js`)                                                                                                                        |
| `rn-doc-blur-detector/pdf` | Cross-platform PDF and image extraction (`iOS/Android/Web`), `PDF_WEBVIEW_HTML` (vendored offline `pdfjs-dist@4.10.38` on iOS/Android), `createPdfBridgeController()`, and document/file helpers |

## Installation

```bash
npm install rn-doc-blur-detector
```

> If you plan to render PDFs on iOS/Android via `rn-doc-blur-detector/pdf`, also install `react-native-webview` in your host app (and run `cd ios && pod install` on Bare React Native iOS).

---

## Usage

### 1. Core Engine (RGBA, Grayscale Luminance, or JPEG Base64)

Works everywhere (Expo, Bare React Native, Web, Node.js):

```ts
import {
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
  },
);

// Directly from a grayscale luminance buffer (e.g. Y-plane from VisionCamera Frame Processors)
const lumResult = analyzeLuminanceBlur(yPlane, 1200, 1600, { locale: "en" });

// From a JPEG Base64 string (e.g. react-native-image-picker with includeBase64: true)
const jpegResult = analyzeJpegBase64Blur(jpegBase64, { locale: "en" });
```

### 2. Multi-page PDFs on React Native (Expo or Bare RN)

In your host app, wire `PDF_WEBVIEW_HTML` and `createPdfBridgeController()` to a hidden `<WebView>` from `react-native-webview`.

If your app also targets **Web**, keep `react-native-webview` out of the Web bundle by splitting a `.web.tsx` stub:

```tsx
// pdf-render-bridge.tsx (iOS & Android)
import {
  type ComponentType,
  forwardRef,
  type RefAttributes,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { StyleSheet, View } from "react-native";
import WebView, {
  type WebViewMessageEvent,
  type WebViewProps,
} from "react-native-webview";
import {
  createPdfBridgeController,
  PDF_WEBVIEW_HTML,
  type PdfBridgeRunner,
} from "rn-doc-blur-detector/pdf";

interface WebViewRefHandle {
  injectJavaScript: (script: string) => void;
}

// react-native-webview's WebView is typed as FunctionComponent<WebViewProps>,
// so cast it with RefAttributes for React 18/19 + TypeScript compatibility.
const TypedWebView = WebView as unknown as ComponentType<
  WebViewProps & RefAttributes<WebViewRefHandle>
>;

export interface PdfRenderBridgeHandle {
  runPdfJob: PdfBridgeRunner;
}

export const PdfRenderBridge = forwardRef<PdfRenderBridgeHandle>(
  function PdfRenderBridge(_props, ref) {
    const webViewRef = useRef<WebViewRefHandle>(null);
    const controller = useMemo(() => createPdfBridgeController(), []);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        controller.handleMessage(event.nativeEvent.data);
      },
      [controller],
    );

    useImperativeHandle(
      ref,
      () => ({
        runPdfJob: (params) =>
          controller.runJob(params, (script) => {
            if (!webViewRef.current) {
              throw new Error("PDF WebView is not mounted.");
            }
            webViewRef.current.injectJavaScript(script);
          }),
      }),
      [controller],
    );

    return (
      <View pointerEvents="none" style={styles.hiddenWrap}>
        <TypedWebView
          ref={webViewRef}
          source={{ html: PDF_WEBVIEW_HTML }}
          originWhitelist={["*"]}
          javaScriptEnabled
          onMessage={handleMessage}
          style={styles.hiddenWebView}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  hiddenWrap: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  hiddenWebView: { width: 1, height: 1 },
});
```

```tsx
// pdf-render-bridge.web.tsx (Web stub — avoids bundling react-native-webview)
import { forwardRef, useImperativeHandle } from "react";
import type { PdfBridgeRunner } from "rn-doc-blur-detector/pdf";

export interface PdfRenderBridgeHandle {
  runPdfJob?: PdfBridgeRunner;
}

export const PdfRenderBridge = forwardRef<PdfRenderBridgeHandle>(
  function PdfRenderBridge(_props, ref) {
    useImperativeHandle(ref, () => ({}), []);
    return null;
  },
);
```

Then call `analyzePdf` (or `extractPdfPages`):

```ts
import { analyzePdf } from "rn-doc-blur-detector/pdf";

const result = await analyzePdf(
  { uri: pdfUri }, // or { uri: "", base64 }
  {
    maxPages: 2,
    config: { locale: "en" },
    renderPdfViaBridge: pdfBridgeRef.current?.runPdfJob, // ignored on Web
    // Optional on iOS/Android: omit to use built-in fetch + FileReader for file:// and content:// URIs
    // readFileAsBase64: (uri) => ...,
  },
);
```

- **iOS & Android:** `PDF_WEBVIEW_HTML` automatically resolves `pdf-webview-html.native.js`, loading the vendored offline `pdfjs-dist@4.10.38` bundle via `Blob` URLs.
- **Web:** `extractImagePage` / `extractPdfPages` / `analyzePdf` use `HTMLCanvasElement` and `pdfjs-dist@4.10.38` via jsDelivr CDN (and `pdf-webview-html.js` also uses the CDN fallback).

### 3. Bare React Native Pattern (without Expo)

Because `rn-doc-blur-detector` has zero `expo-*` dependencies, Bare React Native apps can analyze camera/gallery photos and PDFs without `expo-image-manipulator` or `expo-file-system`:

```ts
import { launchImageLibrary } from "react-native-image-picker";
import { pick, keepLocalCopy, types } from "@react-native-documents/picker";
import { DEFAULT_LAPLACIAN_CONFIG } from "rn-doc-blur-detector";
import { analyzeImage, analyzePdf } from "rn-doc-blur-detector/pdf";

// 1) Images: let the native picker resize and output a compatible JPEG base64 payload
const imgRes = await launchImageLibrary({
  mediaType: "photo",
  maxWidth: DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
  maxHeight: DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
  quality: 1,
  includeBase64: true,
  assetRepresentationMode: "compatible", // avoids HEIC on iOS
});
const asset = imgRes.assets?.[0];
if (asset?.uri) {
  const { analysis } = await analyzeImage(
    {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      base64: asset.base64,
    },
    { config: { locale: "en" } },
  );
  console.log(analysis.status, analysis.score);
}

// 2) PDFs: copy to local cache and pass the URI directly (built-in fetch + FileReader reads it)
const [picked] = await pick({ type: [types.pdf] });
if (picked) {
  const [copied] = await keepLocalCopy({
    files: [{ uri: picked.uri, fileName: picked.name ?? "document.pdf" }],
    destination: "cachesDirectory",
  });
  const localUri = copied.status === "success" ? copied.localUri : picked.uri;

  const pdfResult = await analyzePdf(
    { uri: localUri },
    {
      maxPages: 2,
      config: { locale: "en" },
      // From <PdfRenderBridge ref={pdfBridgeRef} /> mounted in your component tree
      renderPdfViaBridge: pdfBridgeRef.current?.runPdfJob,
    },
  );
  console.log(pdfResult.summary);
}
```

> For non-JPEG image URIs without a `base64` payload on Bare React Native (e.g. PNG/HEIC from a document picker), pass a custom `extractImageAdapter` (such as `@bam.tech/react-native-image-resizer` or Skia) to `extractImagePage` / `analyzeImage`.

### 4. Expo Adapter Pattern (Recommended for Large Camera Photos / HEIC / PNG)

Expo apps can resize large camera photos natively (and convert PNG/HEIC/WebP to JPEG) using `expo-image-manipulator` + `expo-file-system`:

```ts
// document-loader.ts (in your Expo app)
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import {
  DEFAULT_LAPLACIAN_CONFIG,
  decodeJpegBase64ToRgba,
} from "rn-doc-blur-detector";
import {
  extractImagePage as extractImagePageFromPkg,
  extractPdfPages as extractPdfPagesFromPkg,
  type ExtractedDocumentPage,
  type ImageSourceInput,
  type PdfExtractOptions,
  type PdfSourceInput,
} from "rn-doc-blur-detector/pdf";

export async function extractImagePage(
  source: ImageSourceInput,
  maxDim = DEFAULT_LAPLACIAN_CONFIG.maxAnalysisDim,
): Promise<ExtractedDocumentPage> {
  if (Platform.OS === "web") {
    return extractImagePageFromPkg(source, maxDim);
  }

  const context = ImageManipulator.manipulate(source.uri);
  const knownLongest =
    source.width && source.height
      ? Math.max(source.width, source.height)
      : undefined;
  if (!knownLongest || knownLongest > maxDim) {
    const resizeTarget =
      source.width && source.height && source.height > source.width
        ? { height: maxDim }
        : { width: maxDim };
    context.resize(resizeTarget);
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 1,
    base64: true,
  });

  if (!saved.base64) {
    throw new Error("Could not extract pixels from the selected image.");
  }

  const rgba = decodeJpegBase64ToRgba(saved.base64);
  return {
    pageNumber: 1,
    width: rgba.width,
    height: rgba.height,
    rgba,
    previewUri: saved.uri,
    hasVectorText: false,
    textItemCount: 0,
  };
}

export async function extractPdfPages(
  source: PdfSourceInput,
  options: PdfExtractOptions = {},
) {
  if (Platform.OS === "web") {
    return extractPdfPagesFromPkg(source, options);
  }

  return extractPdfPagesFromPkg(source, {
    ...options,
    readFileAsBase64: (uri) => new File(uri).base64(),
  });
}
```

### 5. Document Helpers (`buildAnalyzedDocument`, `validateFileSize`, `isPdfAsset`, `isImageAsset`)

`rn-doc-blur-detector/pdf` also provides pure TypeScript helpers to assemble multi-page document summaries and validate assets:

```ts
import {
  buildAnalyzedDocument,
  DEFAULT_MAX_FILE_SIZE_MB,
  isImageAsset,
  isPdfAsset,
  validateFileSize,
} from "rn-doc-blur-detector/pdf";

const sizeCheck = validateFileSize(file.size, DEFAULT_MAX_FILE_SIZE_MB);
if (!sizeCheck.valid) {
  throw new Error(`File too large: ${sizeCheck.formattedSize}`);
}

// `extractedPdf` from `await extractPdfPages(...)`
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

---

## Configuration & Limits

### PDF Page Limit (`maxPages`)

Both `extractPdfPages` and `analyzePdf` default to `maxPages: 2`. Pass any number—or `Infinity` to process all pages:

```ts
const result = await analyzePdf(
  { uri: pdfUri },
  {
    maxPages: 10, // or Infinity for all pages
    targetMaxDim: 1400,
    renderPdfViaBridge: pdfBridgeRef.current?.runPdfJob,
  },
);
```

### File Size Limit (`validateFileSize`)

`extractImagePage`, `extractPdfPages`, `analyzeImage`, and `analyzePdf` do **not** hard-block files by size. Use `validateFileSize(sizeBytes, maxSizeMb)` (defaults to `DEFAULT_MAX_FILE_SIZE_MB = 9`, or pass `0` / `Infinity` to disable) when you want a pre-flight check.

> **Performance note:** On iOS/Android, each PDF page is rasterized in the hidden WebView and passed back as a JPEG Base64 string. Raising `maxPages` or processing very large PDFs increases memory usage and processing time proportionally.

### WebView Controller Timeouts & Cancellation

`createPdfBridgeController({ readyTimeoutMs, jobTimeoutMs })` defaults to `readyTimeoutMs: 10000` and `jobTimeoutMs: 30000`, and exposes `cancel(reason?)` and `reset()`.

---

## Classification & Thresholds

- `insufficient`: blank page or insufficient contrast (`contrast < 24` or `stdDev < 5.5`)
- `blurry`: `score < 40`
- `borderline`: `40 <= score < 60`
- `sharp`: `score >= 60`

## Build, Test & Publishing

```bash
npm install
npm run typecheck
npm test
npm run pack:check   # preview package contents without creating a .tgz
npm run tarball      # typecheck, test, build, and generate the .tgz tarball
npm publish --access public
```
