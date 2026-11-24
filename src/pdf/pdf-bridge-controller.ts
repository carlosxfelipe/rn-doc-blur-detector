import type {
  PdfBridgeJobParams,
  PdfBridgePagePayload,
  PdfBridgeResult,
} from "./types";

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingJob {
  requestId: string;
  pages: PdfBridgePagePayload[];
  onProgress?: (current: number, total: number) => void;
  resolve: (result: PdfBridgeResult) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export type PdfBridgeIncomingMessage =
  | { type: "ready" }
  | { type: "progress"; requestId: string; current: number; total: number }
  | ({ type: "page"; requestId: string } & PdfBridgePagePayload)
  | {
      type: "done";
      requestId: string;
      totalPages: number;
      processedPages: number;
      truncated: boolean;
    }
  | { type: "error"; requestId: string; message: string };

export interface PdfBridgeController {
  /** Returns whether the WebView has posted its `{ type: "ready" }` handshake. */
  isReady: () => boolean;
  /** Feed `event.nativeEvent.data` from `WebView.onMessage` into this handler. */
  handleMessage: (rawData: string) => void;
  /** Runs a PDF rasterization job using a `WebView.injectJavaScript` callback. */
  runJob: (
    params: PdfBridgeJobParams,
    injectJavaScript: (script: string) => void,
  ) => Promise<PdfBridgeResult>;
  /** Cancels the currently active PDF job, if any. */
  cancel: (reason?: string) => void;
  /** Resets readiness state and rejects any waiting/pending promises. */
  reset: () => void;
}

/**
 * Pure TypeScript state machine for communicating with the hidden PDF.js WebView
 * (`PDF_WEBVIEW_HTML`), without requiring `.tsx` or `react-native-webview` inside this package.
 */
export function createPdfBridgeController(options?: {
  readyTimeoutMs?: number;
  jobTimeoutMs?: number;
}): PdfBridgeController {
  const readyTimeoutMs = options?.readyTimeoutMs ?? 10000;
  const jobTimeoutMs = options?.jobTimeoutMs ?? 30000;
  let ready = false;
  const readyWaiters: ReadyWaiter[] = [];
  let pendingJob: PendingJob | null = null;

  function clearPendingJob(): PendingJob | null {
    const job = pendingJob;
    pendingJob = null;
    if (job?.timer) {
      clearTimeout(job.timer);
    }
    return job;
  }

  function rejectReadyWaiters(error: Error): void {
    const waiters = readyWaiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  function waitUntilReady(): Promise<void> {
    if (ready) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(waiter.timer);
          reject(err);
        },
        timer: setTimeout(() => {
          const idx = readyWaiters.indexOf(waiter);
          if (idx !== -1) readyWaiters.splice(idx, 1);
          reject(new Error("Timed out waiting for PDF renderer WebView."));
        }, readyTimeoutMs),
      };

      readyWaiters.push(waiter);
    });
  }

  function handleMessage(rawData: string): void {
    let payload: PdfBridgeIncomingMessage;
    try {
      payload = JSON.parse(rawData) as PdfBridgeIncomingMessage;
    } catch {
      return;
    }

    if (payload.type === "ready") {
      ready = true;
      const waiters = readyWaiters.splice(0);
      for (const waiter of waiters) {
        waiter.resolve();
      }
      return;
    }

    if (!pendingJob || payload.requestId !== pendingJob.requestId) {
      return;
    }

    if (payload.type === "progress") {
      pendingJob.onProgress?.(payload.current, payload.total);
    } else if (payload.type === "page") {
      pendingJob.pages.push({
        pageNumber: payload.pageNumber,
        totalPages: payload.totalPages,
        width: payload.width,
        height: payload.height,
        base64: payload.base64,
        hasVectorText: payload.hasVectorText,
        textItemCount: payload.textItemCount,
      });
    } else if (payload.type === "done") {
      const finished = clearPendingJob();
      finished?.resolve({
        totalPages: payload.totalPages,
        processedPages: payload.processedPages,
        truncated: payload.truncated,
        pages: finished.pages,
      });
    } else if (payload.type === "error") {
      const failed = clearPendingJob();
      failed?.reject(new Error(payload.message));
    }
  }

  async function runJob(
    params: PdfBridgeJobParams,
    injectJavaScript: (script: string) => void,
  ): Promise<PdfBridgeResult> {
    await waitUntilReady();

    if (pendingJob) {
      const superseded = clearPendingJob();
      superseded?.reject(
        new Error("Replaced by a newer PDF analysis request."),
      );
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<PdfBridgeResult>((resolve, reject) => {
      const timer =
        jobTimeoutMs > 0
          ? setTimeout(() => {
              if (pendingJob?.requestId === requestId) {
                const timedOut = clearPendingJob();
                timedOut?.reject(
                  new Error("Timed out while rendering PDF pages."),
                );
              }
            }, jobTimeoutMs)
          : undefined;

      pendingJob = {
        requestId,
        pages: [],
        onProgress: params.onProgress,
        resolve,
        reject,
        timer,
      };

      const jobPayload = JSON.stringify({
        requestId,
        base64: params.base64,
        maxPages: params.maxPages,
        targetMaxDim: params.targetMaxDim,
      });

      try {
        injectJavaScript(
          `window.__startPdfJob && window.__startPdfJob(${jobPayload}); true;`,
        );
      } catch (err) {
        const failed = clearPendingJob();
        failed?.reject(
          err instanceof Error
            ? err
            : new Error("Failed to inject PDF job into WebView."),
        );
      }
    });
  }

  function cancel(reason = "PDF analysis was cancelled."): void {
    const cancelled = clearPendingJob();
    cancelled?.reject(new Error(reason));
  }

  function reset(): void {
    ready = false;
    rejectReadyWaiters(new Error("PDF renderer WebView was reset."));
    cancel("PDF renderer WebView was reset.");
  }

  return {
    isReady: () => ready,
    handleMessage,
    runJob,
    cancel,
    reset,
  };
}
