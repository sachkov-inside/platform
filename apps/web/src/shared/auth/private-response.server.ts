import "server-only";

export function privateAuthenticatedResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, private");
  const vary = headers.get("vary");
  if (vary === null) headers.set("vary", "cookie");
  else if (
    !vary
      .toLowerCase()
      .split(",")
      .some((value) => value.trim() === "cookie")
  ) {
    headers.set("vary", `${vary}, cookie`);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
