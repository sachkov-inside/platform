import { createServer } from "node:http";
import { once } from "node:events";
import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { z } from "zod";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { bankRequest } from "../../src/modules/billing/infrastructure/tbank/bank-request.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BillingPayments } from "../../src/modules/billing/index.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { localTbankConfig } from "../../src/config/tbank-config.js";
import { createLocalBankDouble } from "../../src/development/bank-double/local-bank-double.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());
test.each([
  ["confirmed", "confirmed"],
  ["rejected", "failed"],
  ["canceled", "failed"],
  ["expired", "failed"],
] as const)(
  "local bank form %s reaches the real Product buyer boundary as %s",
  async (outcome, state) => {
    const s = await world.scenario();
    const config = localTbankConfig({});
    const double = createLocalBankDouble({
      config,
      notify: async (_url, payload) => {
        const result = await payments.notification(payload);
        if (!result.ok) throw new Error(result.error.code);
      },
    });
    const bank = new Tbank(config, (url, init) =>
      double.handle(
        new Request(url, {
          method: init.method,
          headers: init.headers,
          body: init.body,
        }),
      ),
    );
    const payments = new BillingPayments({
      prisma: world.db.prisma,
      bank,
      contact: s.contact,
      grants: s.grants,
      clock: () => new Date("2030-01-31T10:00:00Z"),
      contentCatalog: new CoverageCatalog(
        world.db.prisma,
        new ProductDiscovery(world.db.prisma),
      ),
    });
    const purchase = value(await payments.purchase(s.buyer, s.command));
    if (purchase.paymentUrl === null) throw new Error("Missing bank form");
    expect(
      (
        await double.handle(
          new Request(purchase.paymentUrl, {
            method: "POST",
            body: new URLSearchParams({ outcome }),
          }),
        )
      ).status,
    ).toBeLessThan(400);
    await payments.recover();
    expect(
      value(await payments.status(s.buyer, purchase.purchaseRef)).state,
    ).toBe(state);
    const right = await s.grants.readProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
    });
    expect(right.ok).toBe(outcome === "confirmed");
  },
);

test("наблюдение HTTP к двойнику сохраняет unknown и не повторяет Init при сверке", async (owner) => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  const s = await world.scenario();
  const config = localTbankConfig({});
  const formOrigin = config.endpoints.formOrigins[0];
  if (formOrigin === undefined) throw new Error("missing form origin");
  const double = createLocalBankDouble({
    config,
    notify: async (_url, payload) => {
      const result = await payments.notification(payload);
      if (!result.ok) throw new Error(result.error.code);
    },
  });
  const wireMethods: string[] = [];
  const preIoStates: string[] = [];
  const server = createServer((incoming, outgoing) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) incoming.destroy();
    });
    incoming.on("end", () => {
      const path = incoming.url ?? "/";
      wireMethods.push(path.split("/").at(-1) ?? "");
      expect(incoming.headers["traceparent"]).toBeUndefined();
      const deliver = async () => {
        if (path.endsWith("/Init")) {
          const sent = z
            .object({ OrderId: z.string() })
            .parse(JSON.parse(body));
          const row = await world.db.prisma.billingPurchase.findUniqueOrThrow({
            where: { id: sent.OrderId },
          });
          preIoStates.push(row.state);
        }
        return double.handle(
          new Request(new URL(path, formOrigin), {
            method: incoming.method ?? "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        );
      };
      void deliver()
        .then(async (response) => {
          outgoing.writeHead(
            response.status,
            Object.fromEntries(response.headers),
          );
          outgoing.end(await response.text());
        })
        .catch(() => outgoing.destroy());
    });
  });
  owner.onTestFinished(async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("owned bank listener unavailable");
  const bankConfig = {
    ...config,
    endpoints: {
      ...config.endpoints,
      apiBaseUrl: `http://127.0.0.1:${address.port}/v2`,
    },
  };

  const bank = new Tbank(bankConfig, bankRequest(undefined));
  const payments = new BillingPayments({
    prisma: world.db.prisma,
    bank,
    contact: s.contact,
    grants: s.grants,
    clock: () => new Date("2030-01-31T10:00:00Z"),
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
  });
  const root = telemetry.startHttp({
    method: "POST",
    route: "/billing/products/purchase",
  });
  const purchase = value(
    await root.run(() => payments.purchase(s.buyer, s.command)),
  );
  root.finish(200, 1);
  if (purchase.paymentUrl === null) throw new Error("Missing bank form");
  await double.handle(
    new Request(purchase.paymentUrl, {
      method: "POST",
      body: new URLSearchParams({ outcome: "unknown" }),
    }),
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    await telemetry.runJob(() => payments.reconcile(purchase.purchaseRef));
    expect(
      await world.db.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: purchase.purchaseRef },
      }),
    ).toMatchObject({ state: "unknown" });
  }
  expect(
    (
      await s.grants.readProductAccess(world.owner, {
        accountId: s.buyer,
        productId: s.productId,
      })
    ).ok,
  ).toBe(false);
  expect(wireMethods).toEqual(["Init", "GetState", "GetState"]);
  expect(preIoStates).toEqual(["sent"]);
  expect(wireMethods.filter((method) => method === "Charge")).toHaveLength(0);
  await telemetry.flush();
  const clientSpans = spans
    .getFinishedSpans()
    .filter((span) => span.attributes["dependency.name"] === "tbank");
  expect(
    clientSpans.map((span) => span.attributes["dependency.operation"]),
  ).toEqual(wireMethods);
  const httpRoot = spans
    .getFinishedSpans()
    .find((span) => span.kind === SpanKind.SERVER);
  expect(
    clientSpans.find((span) => span.name === "tbank Init")?.parentSpanContext
      ?.spanId,
  ).toBe(httpRoot?.spanContext().spanId);
  expect(
    JSON.stringify(
      clientSpans.map((span) => ({
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain(purchase.purchaseRef);
});
