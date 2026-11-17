import { expect, vi, type Mock } from "vitest";

export function interceptIdentityOutage() {
  const identity = vi.fn<(request: Request) => Promise<Response>>(() =>
    Promise.reject(new Error("private identity provider detail")),
  );
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    identity(new Request(input, init)),
  );
  return identity;
}

export function expectIdentityOutage(
  identity: Mock<(request: Request) => Promise<Response>>,
): void {
  expect(identity).toHaveBeenCalled();
  for (const [request] of identity.mock.calls) {
    expect(new URL(request.url).origin).toBe("https://identity.example.test");
    expect(request.method).toBe("GET");
  }
}
