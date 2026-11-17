import { vi } from "vitest";

/** External catalogue HTTP endpoints; callers exercise the real generated Web transport. */
export function catalogBackend() {
  const prices = vi.fn<(request: Request) => Promise<Response>>();
  const sales = vi.fn<(request: Request) => Promise<Response>>();
  const access = vi.fn<(request: Request) => Promise<Response>>();
  const fetch = vi.fn((request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      url.origin !== "https://platform-api.example.test"
    ) {
      throw new Error(
        `Unexpected catalogue request ${request.method} ${request.url}`,
      );
    }
    if (url.pathname === "/billing/product-prices") return prices(request);
    if (url.pathname === "/billing/product-sales-states") return sales(request);
    if (/^\/accounts\/current\/products\/[^/]+\/access$/u.test(url.pathname))
      return access(request);
    throw new Error(`Unexpected catalogue endpoint ${request.url}`);
  });
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  vi.stubGlobal("fetch", fetch);
  return { prices, sales, access, fetch };
}
