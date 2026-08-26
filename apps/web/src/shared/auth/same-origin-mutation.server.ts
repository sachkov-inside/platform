import "server-only";

export function isSameOriginMutation(request: Request, baseUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
