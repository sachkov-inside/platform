import "server-only";

export function bindAuthorizationCodeResource(
  init: RequestInit | undefined,
  audience: string,
): RequestInit | undefined {
  if (typeof init?.body !== "string") {
    return init;
  }
  const body = new URLSearchParams(init.body);
  if (body.get("grant_type") !== "authorization_code") {
    return init;
  }
  body.set("resource", audience);
  return { ...init, body: body.toString() };
}
