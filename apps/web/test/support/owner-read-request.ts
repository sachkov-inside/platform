import { expect } from "vitest";

/** Observable private GET contract at the external owner API boundary. */
export function expectOwnerReadRequest(
  request: Request | undefined,
  path: string,
  query: Readonly<Record<string, string>>,
): void {
  if (request === undefined) throw new Error("Expected owner API HTTP request");
  const url = new URL(request.url);
  expect(url.origin + url.pathname).toBe(
    `https://platform-api.example.test${path}`,
  );
  expect(request.method).toBe("GET");
  expect(Object.fromEntries(url.searchParams)).toEqual(query);
  expect(request.headers.get("authorization")).toBe("Bearer owner-token");
}
