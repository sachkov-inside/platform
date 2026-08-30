import "server-only";

export function safePostSignInReturnUri(
  value: unknown,
  baseUrl: string,
): string | undefined {
  if (typeof value !== "string" || value.startsWith("//")) {
    return undefined;
  }
  try {
    const base = new URL(baseUrl);
    const target = value.startsWith("/") ? new URL(value, base) : new URL(value);
    return target.origin === base.origin ? target.toString() : undefined;
  } catch {
    return undefined;
  }
}
