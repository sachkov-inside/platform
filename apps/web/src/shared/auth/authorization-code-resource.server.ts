import "server-only";

export function bindAuthorizationCodeResource(
  init: RequestInit | undefined,
  audience: string,
): RequestInit | undefined {
  const encodedBody =
    typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : undefined;
  if (encodedBody === undefined) {
    return init;
  }
  const body = new URLSearchParams(encodedBody);
  if (body.get("grant_type") !== "authorization_code") {
    return init;
  }
  body.set("resource", audience);
  return { ...init, body: body.toString() };
}
