import { vi } from "vitest";

/** External owner Billing service endpoints, receiving the actual generated transport requests. */
export function ownerBillingBackend() {
  const command = vi.fn<(request: Request) => Promise<Response>>();
  const sales = vi.fn<(request: Request) => Promise<Response>>();
  const fetch = (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== "https://platform-api.example.test")
      throw new Error(`Unexpected service ${url.origin}`);
    if (url.pathname === "/billing/admin" && request.method === "POST")
      return command(request);
    if (
      url.pathname === "/billing/product-sales-states" &&
      request.method === "GET"
    )
      return sales(request);
    throw new Error(
      `Unexpected owner Billing request ${request.method} ${request.url}`,
    );
  };
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  vi.stubGlobal("fetch", fetch);
  return { command, sales, fetch };
}
