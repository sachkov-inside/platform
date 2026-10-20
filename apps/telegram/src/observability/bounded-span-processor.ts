import { ExportResultCode } from "@opentelemetry/core";
import { TraceFlags } from "@opentelemetry/api";
import type {
  ReadableSpan,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { rejectFailures } from "../shared/drain-report.js";

/** Serial ownership includes the batch currently held by the pinned, timeout-bounded exporter. */
export function createBoundedSpanProcessor(
  exporter: SpanExporter,
  counters: { dropped(): void; failed(): void },
): SpanProcessor {
  const queue: ReadableSpan[] = [];
  let pending = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function forceFlush(): Promise<void> {
    clearTimer();
    if (draining !== undefined) return draining;
    // Publish ownership before invoking any external exporter, including synchronous callbacks.
    draining = Promise.resolve()
      .then(async () => {
        let failed = false;
        while (queue.length !== 0) {
          const batch = queue.splice(0, 64);
          const succeeded = await new Promise<boolean>((resolve) => {
            let completed = false;
            const complete = (success: boolean): void => {
              if (completed) return;
              completed = true;
              pending -= batch.length;
              if (!success) counters.failed();
              resolve(success);
            };
            try {
              exporter.export(batch, (result) =>
                complete(result.code === ExportResultCode.SUCCESS),
              );
            } catch {
              complete(false);
            }
          });
          if (!succeeded) failed = true;
        }
        if (failed) throw new Error("Telegram trace export failed");
      })
      .finally(() => {
        draining = undefined;
      });
    return draining;
  }

  return {
    onStart: () => undefined,
    onEnd: (span) => {
      if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) === 0) return;
      if (closed || pending >= 512) {
        counters.dropped();
        return;
      }
      pending++;
      queue.push(span);
      if (queue.length >= 64) {
        void forceFlush().catch(() => undefined);
      } else if (draining === undefined && timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          void forceFlush().catch(() => undefined);
        }, 5000);
        timer.unref();
      }
    },
    forceFlush,
    shutdown: () => {
      if (closing !== undefined) return closing;
      closed = true;
      clearTimer();
      closing = Promise.resolve().then(async () => {
        const failures: unknown[] = [];
        try {
          await forceFlush();
        } catch (error) {
          failures.push(error);
        }
        try {
          await exporter.shutdown();
        } catch (error) {
          failures.push(error);
        }
        rejectFailures(failures);
      });
      return closing;
    },
  };
}
