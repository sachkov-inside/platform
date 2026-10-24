import { createServer, type RequestListener } from "node:http";
import type { Socket } from "node:net";
import { expect, test, vi, type TestContext } from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import { loadProductOffers } from "@/entities/subscription/api/billing-catalog.server";

const productId = "17100000-0000-4000-8000-000000000010";
const requestBudgetMs = 1000;
const shutdownBudgetMs = 1000;
const contractBudgetMs = 7000;
const nativeFetch = globalThis.fetch;

/** Real loopback transport, with one owner for requests, listener and every accepted socket. */
async function ownedListener(
  context: TestContext,
  handler: RequestListener,
  port = 0,
) {
  const server = createServer(handler);
  const lifetime = new AbortController();
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let stopped: Promise<void> | undefined;
  function dispose(): Promise<void> {
    if (stopped !== undefined) return stopped;
    stopped = (async () => {
      lifetime.abort();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      if (!server.listening) return;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) =>
            server.close((error) => {
              if (error === undefined) resolve();
              else reject(error);
            }),
          ),
          new Promise<never>((_, reject) => {
            // deterministic-test-allow duration-wait: real listener shutdown watchdog, never a readiness wait.
            deadline = setTimeout(() => {
              reject(new Error("Loopback shutdown exceeded its budget"));
            }, shutdownBudgetMs);
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    })();
    return stopped;
  }
  // Registered before listen: setup failure and test timeout use the same bounded owner cleanup.
  context.onTestFinished(dispose);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Synthetic HTTP listener required");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  vi.stubGlobal(
    "fetch",
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      nativeFetch(input, {
        ...init,
        signal: AbortSignal.any([
          lifetime.signal,
          AbortSignal.timeout(requestBudgetMs),
          ...(init?.signal == null ? [] : [init.signal]),
        ]),
      }),
  );
  vi.stubEnv("BACKEND_BASE_URL", origin);
  return { origin, server, dispose };
}

test(
  "the actual generated transport keeps the exact Product scope and a stopped Product gets no foreign price",
  { timeout: contractBudgetMs },
  async (context) => {
    const reads: URL[] = [];
    const listener = await ownedListener(context, (request, response) => {
      const url = new URL(request.url ?? "/", "http://loopback.invalid");
      reads.push(url);
      const matching = url.searchParams.get("productId") === productId;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          items: matching ? [] : [productWithSupportOffer],
          nextCursor: null,
        }),
      );
    });
    expect(
      await (
        await fetch(
          `${listener.origin}/billing/product-prices?productId=${productId}`,
        )
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
    reads.length = 0;
    expect(await loadProductOffers(productId)).toEqual({
      kind: "ready",
      offers: [],
    });
    expect(reads).toHaveLength(1);
    expect(reads[0]?.searchParams.get("productId")).toBe(productId);
  },
);

test(
  "even a successful HTTP response cannot substitute another Product's price",
  { timeout: contractBudgetMs },
  async (context) => {
    await ownedListener(context, (_, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ items: [productWithSupportOffer], nextCursor: null }),
      );
    });
    expect(await loadProductOffers(productId)).toEqual({ kind: "unavailable" });
  },
);

test(
  "a held real response aborts within the request budget and owned cleanup releases the listener",
  { timeout: contractBudgetMs },
  async (context) => {
    const { promise: received, resolve: started } =
      Promise.withResolvers<undefined>();
    const listener = await ownedListener(context, () => {
      started(undefined);
    });
    const pending = loadProductOffers(productId);
    await received;
    expect(await pending).toEqual({ kind: "unavailable" });
    await listener.dispose();
    expect(listener.server.listening).toBe(false);
    const connections = await new Promise<number>((resolve, reject) =>
      listener.server.getConnections((error, count) => {
        if (error !== null) reject(error);
        else resolve(count);
      }),
    );
    expect(connections).toBe(0);
    const rebound = await ownedListener(
      context,
      (_, response) => {
        response.end();
      },
      Number(new URL(listener.origin).port),
    );
    expect(rebound.origin).toBe(listener.origin);
  },
);

test(
  "owner interruption aborts a held request before teardown releases every connection",
  { timeout: contractBudgetMs },
  async (context) => {
    const { promise: received, resolve: started } =
      Promise.withResolvers<undefined>();
    const listener = await ownedListener(context, () => {
      started(undefined);
    });
    const pending = loadProductOffers(productId);
    await received;
    await listener.dispose();
    expect(await pending).toEqual({ kind: "unavailable" });
    expect(listener.server.listening).toBe(false);
  },
);
