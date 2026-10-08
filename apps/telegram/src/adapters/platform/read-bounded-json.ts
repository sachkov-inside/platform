/** Reads only transport JSON; each adapter owns status and domain validation. */
export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  let complete = false;
  let onAbort: () => void = () => {
    // Replaced synchronously by the Promise executor.
  };
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : new DOMException("Response read aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    signal.throwIfAborted();
    if (
      response.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return undefined;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (part.done) {
        complete = true;
        break;
      }
      size += part.value.byteLength;
      if (size > maxBytes) return undefined;
      chunks.push(part.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value;
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Cancellation must not extend the request deadline if a provider stalls cleanup.
    if (!complete)
      void reader.cancel().catch(() => {
        // A cleanup failure cannot replace the transport outcome.
      });
    reader.releaseLock();
  }
}
