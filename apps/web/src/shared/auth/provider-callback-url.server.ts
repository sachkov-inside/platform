import "server-only";

export function providerCallbackUrl(
  requestUrl: string,
  baseUrl: string,
  pathname: "/callback" | "/reauthentication-callback",
): string {
  const incoming = new URL(requestUrl);
  const callback = new URL(pathname, baseUrl);
  callback.search = incoming.search;
  return callback.toString();
}
