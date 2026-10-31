/** One deadline for the SDK batch processor, metric reader and both OTLP transports. */
export const TELEMETRY_EXPORT_TIMEOUT_MS = 1_000;
export const TELEMETRY_MAX_PENDING_SPANS = 512;
export const TELEMETRY_SPAN_BATCH_SIZE = 64;
// At most eight admitted batches, plus the slot whose callback precedes SDK queue removal.
export const TELEMETRY_TRACE_CONCURRENCY =
  Math.ceil(TELEMETRY_MAX_PENDING_SPANS / TELEMETRY_SPAN_BATCH_SIZE) + 1;
