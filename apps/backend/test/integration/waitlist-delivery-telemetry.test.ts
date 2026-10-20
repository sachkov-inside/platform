import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect, test, vi, onTestFinished } from "vitest";
import { z } from "zod";
import { waitlistConfirmationSchema } from "@inside/contracts/waitlist-confirmation";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { eventually } from "./setup/eventually.js";
import { registerFixedClock } from "../support/fixed-clock.js";

registerFixedClock();
const spanSchema = z.object({
  name: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.object({ stringValue: z.string().optional() }),
    }),
  ),
});
const exportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })),
      }),
    )
    .optional(),
});

/** Real API, authenticated HTTP, real PG, restart and its ordinary five-second relay. No direct dispatch. */
test.each(["on", "off", "exporter503"] as const)(
  "waitlist carrier survives API restart without changing queued receipt or membership (%s)",
  async (mode) => {
    const db = await createMigratedTestDatabase();
    onTestFinished(() => db.dispose());
    const identity = await startTestIdentityIssuer({
      issuer: "https://waitlist-causality.test",
      audience: "https://waitlist-causality.test/api",
    });
    onTestFinished(() => identity.close());
    const exports: unknown[] = [];
    const calls: z.infer<typeof waitlistConfirmationSchema>[] = [];
    const releases: (() => Promise<void>)[] = [];
    onTestFinished(async () => {
      for (const release of releases.reverse()) await release();
    });
    async function listen(handler: RequestListener) {
      const server = createServer(handler);
      releases.push(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Owned listener missing");
      return `http://127.0.0.1:${address.port}`;
    }
    const collector = await listen((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        if (request.url === "/v1/traces" && mode === "on")
          exports.push(JSON.parse(body));
        response.writeHead(mode === "exporter503" ? 503 : 200, {
          "content-type": "application/json",
        });
        response.end("{}");
      });
    });
    const provider = await listen((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        const parsed = waitlistConfirmationSchema.safeParse(JSON.parse(body));
        if (
          !parsed.success ||
          request.headers.authorization !== "Bearer private-waitlist-secret" ||
          request.headers["traceparent"] !== undefined ||
          request.headers["baggage"] !== undefined
        ) {
          response.writeHead(400).end();
          return;
        }
        calls.push(parsed.data);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ eventId: parsed.data.eventId, status: "accepted" }),
        );
      });
    });
    vi.stubEnv("INSIDE_OTEL_ENABLED", mode === "off" ? "false" : "true");
    vi.stubEnv("INSIDE_OTEL_ENDPOINT", collector);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const accountId = (
      await bootstrapOwnerAccount(
        db.prisma,
        { issuer: identity.issuer, subject: "member" },
        "materials:manage",
      )
    ).accountId;
    const productId = randomUUID();
    const intakeId = randomUUID();
    await db.prisma.product.create({
      data: { id: productId, slug: "waitlist-causality", name: "Waitlist" },
    });
    await db.prisma.productWaitlistIntake.create({
      data: { id: intakeId, productId, name: "Next", accepting: true },
    });
    await db.prisma.telegramAccountLinkState.create({
      data: {
        accountId,
        linkRef: randomUUID(),
        revision: 1,
        principalRef: "private-account-ref",
        identityRef: "private-identity-ref",
        updatedAt: new Date("2026-10-07T09:00:00Z"),
      },
    });
    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      LOGTO_ISSUER: identity.issuer,
      LOGTO_AUDIENCE: identity.audience,
      LOGTO_JWKS_URL: identity.jwksUrl,
      TELEGRAM_COMMUNICATIONS_ENDPOINT: provider,
      TELEGRAM_COMMUNICATIONS_SECRET: "private-waitlist-secret",
      TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "private-bot",
    });
    const applications = new Set<NestFastifyApplication>();
    onTestFinished(async () => {
      for (const app of applications) await app.close();
    });
    async function open() {
      const app = await createApiApplication(config, { logger: false });
      applications.add(app);
      await app.listen(0, "127.0.0.1");
      return app;
    }
    const first = await open();
    const token = await identity.sign("member");
    const operationId = randomUUID();
    const join = async (app: NestFastifyApplication) => {
      const response = await fetch(
        `${await app.getUrl()}/product-waitlists/join`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ intakeId, operationId, source: null }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ intakeId, active: true });
    };
    await join(first);
    const before =
      await db.prisma.productWaitlistConfirmation.findFirstOrThrow();
    if (mode === "off") expect(before.traceparent).toBeNull();
    else
      expect(before.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
    expect(before.completedAt).toBeNull();
    expect(calls).toHaveLength(0);
    await first.close();
    applications.delete(first);
    const second = await open();
    await join(second); // Same operation is accepted without overwriting its original causal carrier.
    expect(await db.prisma.productWaitlistConfirmation.count()).toBe(1);
    expect(
      (await db.prisma.productWaitlistConfirmation.findFirstOrThrow())
        .traceparent,
    ).toBe(before.traceparent);
    await eventually(async () => {
      expect(calls).toHaveLength(1);
      expect(
        (await db.prisma.productWaitlistConfirmation.findFirstOrThrow())
          .completedAt,
      ).not.toBeNull();
    }, 20_000);
    expect(calls[0]?.eventId).toBe(before.eventId);
    const membership = await fetch(
      `${await second.getUrl()}/product-waitlists/${productId}/membership`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(membership.status).toBe(200);
    expect(await membership.json()).toMatchObject({ intakeId, active: true });
    await second.close();
    applications.delete(second);
    const spans = exports.flatMap(
      (body) =>
        exportSchema
          .parse(body)
          .resourceSpans?.flatMap((resource) =>
            resource.scopeSpans.flatMap((scope) => scope.spans),
          ) ?? [],
    );
    if (mode === "on") {
      const delivery = spans.filter((span) => span.name === "waitlist deliver");
      expect(delivery).toHaveLength(1);
      expect(delivery[0]?.traceId).toBe(before.traceparent?.slice(3, 35));
      expect(delivery[0]?.parentSpanId).toBe(before.traceparent?.slice(36, 52));
      const source = spans.find(
        (span) => span.spanId === delivery[0]?.parentSpanId,
      );
      expect(source?.name).toBe("POST /product-waitlists/join");
      const client = spans.filter(
        (span) => span.name === "telegram waitlist.confirm",
      );
      expect(client).toHaveLength(1);
      expect(client[0]?.parentSpanId).toBe(delivery[0]?.spanId);
      expect(JSON.stringify(spans)).not.toContain("private-");
    } else expect(spans).toEqual([]);
  },
  45_000,
);
