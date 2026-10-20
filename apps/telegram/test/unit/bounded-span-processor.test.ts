import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { expect, it } from "vitest";
import { createBoundedSpanProcessor } from "../../src/observability/bounded-span-processor.js";
import { deferred } from "../support/deferred.js";

it("keeps exporter ownership within512 and serializes all shutdown batches", async () => {
  const started = Array.from({ length: 8 }, () => deferred());
  const batches: ReadableSpan[][] = [];
  const callbacks: ((result: ExportResult) => void)[] = [];
  let active = 0;
  let maximum = 0;
  let closed = 0;
  let dropped = 0;
  const exporter: SpanExporter = {
    export: (spans, callback) => {
      active++;
      maximum = Math.max(maximum, active);
      batches.push(spans);
      let completed = false;
      callbacks.push((result) => {
        if (completed) return;
        completed = true;
        active--;
        callback(result);
      });
      started[batches.length - 1]?.resolve();
    },
    shutdown: () => {
      closed++;
      return Promise.resolve();
    },
  };
  const processor = createBoundedSpanProcessor(exporter, {
    dropped: () => {
      dropped++;
    },
    failed: () => undefined,
  });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  const tracer = provider.getTracer("telegram-test");
  for (let index = 0; index < 513; index++)
    tracer.startSpan("waitlist receipt").end();
  await started[0]?.promise;
  // The first64 remain owned while the exporter callback is blocked.
  tracer.startSpan("waitlist receipt").end();
  const closing = processor.shutdown();
  expect(processor.shutdown()).toBe(closing);
  try {
    for (let index = 0; index < 8; index++) {
      await started[index]?.promise;
      expect(closed).toBe(0);
      expect(batches).toHaveLength(index + 1);
      expect(active).toBe(1);
      callbacks[index]?.({ code: ExportResultCode.SUCCESS });
    }
    await closing;
    expect(maximum).toBe(1);
    expect(dropped).toBe(2);
    expect(closed).toBe(1);
    expect(batches.map((batch) => batch.length)).toEqual([
      64, 64, 64, 64, 64, 64, 64, 64,
    ]);
    expect(
      new Set(batches.flat().map((span) => span.spanContext().spanId)).size,
    ).toBe(512);
  } finally {
    for (const callback of callbacks)
      callback({ code: ExportResultCode.SUCCESS });
    await provider.shutdown();
  }
});

it("continues serial export cleanup after failure and preserves the original exporter shutdown error", async () => {
  const original = new Error("synthetic shutdown failure");
  const sizes: number[] = [];
  let failed = 0;
  let closed = 0;
  const processor = createBoundedSpanProcessor(
    {
      export: (spans, callback) => {
        sizes.push(spans.length);
        callback({
          code:
            sizes.length === 1
              ? ExportResultCode.FAILED
              : ExportResultCode.SUCCESS,
        });
      },
      shutdown: () => {
        closed++;
        return Promise.reject(original);
      },
    },
    {
      dropped: () => undefined,
      failed: () => {
        failed++;
      },
    },
  );
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  const tracer = provider.getTracer("telegram-test");
  for (let index = 0; index < 128; index++)
    tracer.startSpan("waitlist receipt").end();
  const closing = processor.shutdown();
  await expect(closing).rejects.toMatchObject({
    errors: [expect.any(Error), original],
  });
  expect(sizes).toEqual([64, 64]);
  expect(failed).toBe(1);
  expect(closed).toBe(1);
  await expect(provider.shutdown()).rejects.toMatchObject({
    errors: [expect.any(Error), original],
  });
  expect(closed).toBe(1);
});
