import "server-only";

export function providerCallbackUrl(
  requestUrl: string,
  baseUrl: string,
): string {
  const incoming = new URL(requestUrl);
  const callback = new URL("/callback", baseUrl);
  callback.search = incoming.search;
  return callback.toString();
}
