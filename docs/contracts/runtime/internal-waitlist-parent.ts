/** Pure protocol admission over Node-parsed rawHeaders. Call only after internal auth and strict body decoding. */
export function admitInternalWaitlistParent(
  rawHeaders: readonly string[],
): string | undefined {
  if (rawHeaders.length % 2 !== 0) return undefined;
  let occurrences = 0;
  let value: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const field = rawHeaders[index + 1];
    if (typeof name !== "string" || typeof field !== "string") return undefined;
    if (name.toLowerCase() !== "traceparent") continue;
    occurrences += 1;
    value = field;
  }
  if (occurrences !== 1 || value?.length !== 55) return undefined;
  if (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-(?:00|01)$/.test(value)) return undefined;
  if (
    value.slice(3, 35) === "0".repeat(32) ||
    value.slice(36, 52) === "0".repeat(16)
  )
    return undefined;
  return value;
}
