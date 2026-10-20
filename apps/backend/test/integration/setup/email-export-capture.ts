import { TextDecoder } from "node:util";
import { z } from "zod";

export const EMAIL_EXPORT_CAPTURE_LIMITS = {
  bodyBytes: 1024 * 1024,
  distinctBodies: 32,
  multiplicity: 6,
  inFlight: 4,
  requests: 192,
  sockets: 192,
  highWaterMark: 16 * 1024,
  headerBytes: 16 * 1024,
} as const;
const envelopes = {
  traces: z.strictObject({ resourceSpans: z.array(z.unknown()) }),
  metrics: z.strictObject({ resourceMetrics: z.array(z.unknown()) }),
};
type Signal = "traces" | "metrics" | "other";
export type ExportRequestCounts = Record<Signal, number>;
interface CapturedBody {
  readonly body: string;
  readonly signal: "traces" | "metrics";
  multiplicity: number;
}
const emptyCounts = (): ExportRequestCounts => ({
  traces: 0,
  metrics: 0,
  other: 0,
});

/** Test-only exact-byte multiset. Production exporters and their retry behavior are untouched. */
export function assembleEmailExportCapture() {
  const retained: CapturedBody[] = [];
  const started = emptyCounts();
  const completed = emptyCounts();
  const aborted = emptyCounts();
  const refused = emptyCounts();
  const violations = {
    accounting: 0,
    body_limit: 0,
    distinct_limit: 0,
    incomplete: 0,
    inflight_limit: 0,
    lifecycle: 0,
    malformed: 0,
    multiplicity_limit: 0,
    request_limit: 0,
    roundtrip: 0,
    socket_limit: 0,
    transport: 0,
    unknown_route: 0,
  };
  let active = 0;
  const fault = (code: keyof typeof violations) => {
    violations[code]++;
  };
  const summary = () => ({
    started: { ...started },
    completed: { ...completed },
    aborted: { ...aborted },
    refused: { ...refused },
    active,
    activeBodyBytes: active * EMAIL_EXPORT_CAPTURE_LIMITS.bodyBytes,
    retainedBodies: retained.length,
    retainedBytes: retained.reduce(
      (sum, entry) => sum + Buffer.byteLength(entry.body),
      0,
    ),
    multiplicities: retained.map(({ signal, multiplicity }) => ({
      signal,
      multiplicity,
    })),
    violations: { ...violations },
  });
  return {
    begin(path: string) {
      const signal: Signal =
        path === "/v1/traces"
          ? "traces"
          : path === "/v1/metrics"
            ? "metrics"
            : "other";
      started[signal]++;
      if (
        Object.values(started).reduce((sum, count) => sum + count, 0) >
        EMAIL_EXPORT_CAPTURE_LIMITS.requests
      ) {
        fault("request_limit");
        refused[signal]++;
        return undefined;
      }
      if (signal === "other") {
        fault("unknown_route");
        refused[signal]++;
        return undefined;
      }
      if (active >= EMAIL_EXPORT_CAPTURE_LIMITS.inFlight) {
        fault("inflight_limit");
        refused[signal]++;
        return undefined;
      }
      active++;
      let buffer: Buffer | undefined = Buffer.alloc(
        EMAIL_EXPORT_CAPTURE_LIMITS.bodyBytes,
      );
      let size = 0;
      let closed = false;
      const finish = () => {
        closed = true;
        buffer = undefined;
        active--;
      };
      return {
        write(chunk: Buffer) {
          if (closed || buffer === undefined) return false;
          if (size + chunk.length > EMAIL_EXPORT_CAPTURE_LIMITS.bodyBytes) {
            fault("body_limit");
            refused[signal]++;
            finish();
            return false;
          }
          chunk.copy(buffer, size);
          size += chunk.length;
          return true;
        },
        complete() {
          if (closed || buffer === undefined) {
            fault("lifecycle");
            return;
          }
          try {
            // ignoreBOM preserves BOM codepoints. Fatal decode plus byte roundtrip forbids replacement/stripping.
            const bytes = buffer.subarray(0, size);
            const body = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(bytes);
            if (!Buffer.from(body, "utf8").equals(bytes)) {
              fault("roundtrip");
              refused[signal]++;
              return;
            }
            envelopes[signal].parse(JSON.parse(body));
            const previous = retained.find((entry) => entry.body === body);
            if (previous === undefined) {
              if (
                retained.length >= EMAIL_EXPORT_CAPTURE_LIMITS.distinctBodies
              ) {
                fault("distinct_limit");
                refused[signal]++;
                return;
              }
              retained.push({ body, signal, multiplicity: 1 });
            } else {
              if (
                previous.multiplicity >=
                EMAIL_EXPORT_CAPTURE_LIMITS.multiplicity
              ) {
                fault("multiplicity_limit");
                refused[signal]++;
                return;
              }
              previous.multiplicity++;
            }
            completed[signal]++;
          } catch {
            fault("malformed");
            refused[signal]++;
          } finally {
            finish();
          }
        },
        abort() {
          if (closed) return;
          aborted[signal]++;
          fault("incomplete");
          finish();
        },
      };
    },
    transportFailure() {
      fault("transport");
    },
    connectionSaturation() {
      fault("socket_limit");
    },
    payloads: () => retained.map((entry) => entry.body),
    entries: () => retained.map((entry) => ({ ...entry })),
    summary,
    assertComplete(expected: ExportRequestCounts) {
      const accepted = emptyCounts();
      for (const entry of retained)
        accepted[entry.signal] += entry.multiplicity;
      for (const signal of ["traces", "metrics", "other"] as const) {
        if (
          started[signal] !== expected[signal] ||
          started[signal] !==
            completed[signal] + aborted[signal] + refused[signal] ||
          completed[signal] !== accepted[signal]
        )
          fault("accounting");
      }
      if (active !== 0) fault("accounting");
      if (Object.values(violations).some((count) => count > 0))
        throw new Error(
          `email_export_capture_refused:${JSON.stringify(summary())}`,
        );
    },
  };
}
