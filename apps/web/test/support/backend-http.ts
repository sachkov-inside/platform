import { expect, vi, type Mock } from "vitest";

/** Intercept the external backend HTTP after Web's raw or generated transport. */
export function interceptBackendHttp(
  reply: (request: Request) => Promise<Response>,
): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== "https://platform-api.example.test")
      throw new Error(`Unexpected external request ${request.url}`);
    return reply(request);
  });
}

export function expectSingleBackendRequest(
  backend: Mock<(request: Request) => Promise<Response>>,
  method: string,
  path: string,
  token: string | null = "trusted-token",
): Request {
  expect(backend).toHaveBeenCalledOnce();
  const outgoing = backend.mock.calls[0]?.[0];
  if (outgoing === undefined) throw new Error("Expected backend request");
  expect(outgoing.method).toBe(method);
  expect(outgoing.url).toBe(`https://platform-api.example.test${path}`);
  expect(outgoing.headers.get("authorization")).toBe(
    token === null ? null : `Bearer ${token}`,
  );
  return outgoing;
}
