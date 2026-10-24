import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import { loadProductOffers } from "@/entities/subscription/api/billing-catalog.server";

const productId = "17100000-0000-4000-8000-000000000010";
let server: Server;
let origin: string;
let reads: URL[];
let foreign: boolean;
beforeEach(async () => {
  reads = [];
  foreign = false;
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", origin);
    reads.push(url);
    const matching =
      url.searchParams.get("productId") === productId && !foreign;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        items: matching ? [] : [productWithSupportOffer],
        nextCursor: null,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Synthetic HTTP listener required");
  origin = `http://127.0.0.1:${String(address.port)}`;
  vi.stubEnv("BACKEND_BASE_URL", origin);
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    }),
  );
});
test("the actual generated transport keeps the exact Product scope and a stopped Product gets no foreign price", async () => {
  expect(
    await (
      await fetch(`${origin}/billing/product-prices?productId=${productId}`)
    ).json(),
  ).toEqual({ items: [], nextCursor: null });
  reads = [];
  expect(await loadProductOffers(productId)).toEqual({
    kind: "ready",
    offers: [],
  });
  expect(reads).toHaveLength(1);
  expect(reads[0]?.searchParams.get("productId")).toBe(productId);
});
test("even a successful HTTP response cannot substitute another Product's price", async () => {
  foreign = true;
  expect(await loadProductOffers(productId)).toEqual({ kind: "unavailable" });
});
