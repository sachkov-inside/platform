import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { enrollPriorParticipantsFixture } from "./setup/prior-participants.js";

registerFixedClock();

const requestBudgetMilliseconds = 20_000;
const attributesSchema = z.array(
  z.object({
    key: z.string(),
    value: z.object({
      stringValue: z.string().optional(),
      intValue: z.union([z.string(), z.number()]).optional(),
    }),
  }),
);
const spanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  kind: z.number(),
  name: z.string(),
  attributes: attributesSchema,
});
const pointSchema = z.object({
  attributes: attributesSchema,
  asDouble: z.number().optional(),
  count: z.union([z.string(), z.number()]).optional(),
});
const exportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })),
      }),
    )
    .optional(),
  resourceMetrics: z
    .array(
      z.object({
        scopeMetrics: z.array(
          z.object({
            metrics: z.array(
              z.object({
                name: z.string(),
                sum: z.object({ dataPoints: z.array(pointSchema) }).optional(),
                histogram: z
                  .object({ dataPoints: z.array(pointSchema) })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});
const registrationSchema = z.object({
  accountRef: z.string(),
  expiresAt: z.iso.datetime(),
  returnCorrelation: z.string(),
  tokenDigest: z.string(),
});

test("authenticated production link begin persists one pending receipt and parents one private-safe native Telegram completion", async (owner) => {
  const database = await createMigratedTestDatabase();
  let application: NestFastifyApplication | undefined;
  const releases: (() => Promise<void>)[] = [];
  // API shutdown flushes its SDK while the collector is alive; every acquired listener and database is still released after a failure.
  owner.onTestFinished(async () => {
    const outcomes: PromiseSettledResult<unknown>[] = [];
    try {
      await application?.close();
    } catch (error) {
      outcomes.push({ status: "rejected", reason: error });
    }
    outcomes.push(
      ...(await Promise.allSettled(releases.map((release) => release()))),
    );
    try {
      await database.dispose();
    } catch (error) {
      outcomes.push({ status: "rejected", reason: error });
    }
    const failures = outcomes.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, "Owned API proof cleanup failed");
  });
  async function listen(handler: RequestListener) {
    const server = createServer(handler);
    releases.push(async () => {
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
      throw new Error("Owned listener unavailable");
    return `http://127.0.0.1:${address.port}`;
  }
  const exported: string[] = [];
  const collector = await listen((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) request.destroy();
    });
    request.on("end", () => {
      exported.push(body);
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  const registrations: z.infer<typeof registrationSchema>[] = [];
  const providerFailures: unknown[] = [];
  const provider = await listen((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 16_384) request.destroy();
    });
    request.on("end", () => {
      try {
        expect(request.method).toBe("POST");
        expect(request.url).toBe("/integrations/platform/v1/identity-links");
        expect(request.headers.authorization).toBe(
          "Bearer private-linking-secret-sentinel",
        );
        expect(request.headers["traceparent"]).toBeUndefined();
        expect(request.headers["tracestate"]).toBeUndefined();
        const registration = registrationSchema.parse(JSON.parse(body));
        registrations.push(registration);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            contractVersion: "inside.identity-linking.v1",
            expiresAt: registration.expiresAt,
            linkTransactionRef: "private-provider-link-sentinel",
            returnCorrelation: registration.returnCorrelation,
            status: "pending",
          }),
        );
      } catch (error) {
        providerFailures.push(error);
        response.writeHead(500).end();
      }
    });
  });
  const identity = await startTestIdentityIssuer({
    issuer: "https://telegram-http-proof.example.test/oidc",
    audience: "https://api.telegram-http-proof.example.test",
  });
  releases.push(() => identity.close());
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  vi.stubEnv("INSIDE_OTEL_ENABLED", "true");
  vi.stubEnv("INSIDE_OTEL_ENDPOINT", collector);
  vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "1");
  releases.push(() => {
    vi.unstubAllEnvs();
    return Promise.resolve();
  });
  const config = parsePlatformConfig({
    NODE_ENV: "test",
    DATABASE_URL: database.url,
    LOGTO_ISSUER: identity.issuer,
    LOGTO_AUDIENCE: identity.audience,
    LOGTO_JWKS_URL: identity.jwksUrl,
    IDENTITY_EMAIL_FINGERPRINT_KEY:
      "synthetic-telegram-http-proof-fingerprint-key",
    TELEGRAM_BOT_START_URL: "https://t.me/inside_proof_bot",
    TELEGRAM_LINKING_ENDPOINT:
      provider + "/integrations/platform/v1/identity-links",
    TELEGRAM_LINKING_SECRET: "private-linking-secret-sentinel",
  });
  // The production pumps remain wired. Their owning configuration is absent, so they never start.
  expect(config.communications).toBeUndefined();
  expect(config.communityEntitlements).toBeUndefined();
  application = await createApiApplication(config, { logger: false });
  await application.listen(0, "127.0.0.1");
  const endpoint = await application.getUrl();
  const bearer = await identity.sign("private-link-owner-sentinel", {
    inside_verified_email: "private-link-owner-sentinel@example.invalid",
  });
  async function request(
    method: "GET" | "POST",
    path: string,
    token?: string,
    payload?: unknown,
  ) {
    const response = await fetch(endpoint + path, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(requestBudgetMilliseconds),
    });
    const body: unknown = await response.json();
    assertDeclaredResponse({
      method,
      url: path,
      status: response.status,
      body: () => body,
    });
    return { status: response.status, body };
  }
  expect(
    (await request("POST", "/accounts/current/telegram-link")).status,
  ).toBe(401);
  expect(registrations).toHaveLength(0);
  const established = await request("POST", "/accounts", bearer);
  expect(established.status).toBe(201);
  const { account } = z
    .object({ account: z.object({ accountId: z.uuid() }) })
    .parse(established.body);
  await enrollPriorParticipantsFixture(database.prisma, account.accountId);
  const terms = await request(
    "GET",
    "/accounts/current/legal-acceptances/terms",
    bearer,
  );
  expect(terms.status).toBe(200);
  const { document } = z
    .object({ document: z.object({ version: z.string(), digest: z.string() }) })
    .parse(terms.body);
  expect(
    (
      await request(
        "POST",
        "/accounts/current/legal-acceptances/terms",
        bearer,
        {
          operationId: randomUUID(),
          version: document.version,
          digest: document.digest,
          buttonLabel: "Принять условия и продолжить",
        },
      )
    ).status,
  ).toBe(200);
  const begun = await request(
    "POST",
    "/accounts/current/telegram-link",
    bearer,
  );
  expect(begun.status).toBe(200);
  const pending = z
    .object({
      linkRef: z.uuid(),
      status: z.literal("pending"),
      deepLink: z.string(),
    })
    .parse(begun.body);
  const presentation = await request(
    "GET",
    "/accounts/current/telegram-membership",
    bearer,
  );
  expect(presentation.status).toBe(200);
  expect(presentation.body).toMatchObject({
    link: { kind: "linking", linkRef: pending.linkRef },
  });
  expect(providerFailures).toEqual([]);
  expect(registrations).toHaveLength(1);
  const receipt =
    await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
      where: { linkRef: pending.linkRef },
    });
  expect(receipt).toMatchObject({
    accountId: account.accountId,
    status: "pending",
    providerTransactionRef: "private-provider-link-sentinel",
    principalRef: registrations[0]?.accountRef,
  });
  expect(
    await database.prisma.telegramAccountLinkState.count({
      where: { accountId: account.accountId },
    }),
  ).toBe(0);
  await application.close();
  application = undefined;
  const documents = exported.map((raw) => exportSchema.parse(JSON.parse(raw)));
  const spans = documents.flatMap(
    (value) =>
      value.resourceSpans?.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ) ?? [],
  );
  const logical = [
    ...new Map(
      spans.map((span) => [span.traceId + "/" + span.spanId, span]),
    ).values(),
  ];
  const attribute = (span: z.infer<typeof spanSchema>, key: string) =>
    span.attributes.find((item) => item.key === key)?.value;
  const clients = logical.filter(
    (span) => attribute(span, "dependency.name")?.stringValue === "telegram",
  );
  expect(clients).toHaveLength(1);
  const client = clients[0];
  if (client === undefined) throw new Error("Missing Telegram completion");
  expect(client.kind).toBe(3);
  expect(client.name).toBe("telegram link.register");
  expect(client.attributes.map((item) => item.key).sort()).toEqual([
    "dependency.name",
    "dependency.operation",
    "dependency.outcome",
    "http.request.method",
    "http.response.status_code",
  ]);
  expect(attribute(client, "dependency.outcome")?.stringValue).toBe(
    "completed",
  );
  const parent = logical.find(
    (span) =>
      span.kind === 2 &&
      span.traceId === client.traceId &&
      span.spanId === client.parentSpanId,
  );
  expect(parent).toBeDefined();
  if (parent === undefined) throw new Error("Missing actual API parent");
  expect(attribute(parent, "http.route")?.stringValue).toBe(
    "/accounts/current/telegram-link",
  );
  expect(String(attribute(parent, "http.response.status_code")?.intValue)).toBe(
    "200",
  );
  const metrics = documents.flatMap(
    (value) =>
      value.resourceMetrics?.flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      ) ?? [],
  );
  for (const name of [
    "inside.dependency.operations",
    "inside.dependency.duration",
  ]) {
    const points = metrics
      .filter((metric) => metric.name === name)
      .flatMap(
        (metric) =>
          metric.sum?.dataPoints ?? metric.histogram?.dataPoints ?? [],
      )
      .filter((point) =>
        point.attributes.some(
          (item) =>
            item.key === "dependency" && item.value.stringValue === "telegram",
        ),
      );
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.attributes.map((item) => item.key).sort()).toEqual([
        "dependency",
        "operation",
        "outcome",
      ]);
      expect(
        point.attributes.find((item) => item.key === "operation")?.value
          .stringValue,
      ).toBe("link.register");
      expect(
        point.attributes.find((item) => item.key === "outcome")?.value
          .stringValue,
      ).toBe("completed");
      expect(
        name === "inside.dependency.operations"
          ? point.asDouble
          : Number(point.count),
      ).toBe(1);
    }
  }
  for (const secret of [
    "private-",
    provider,
    bearer,
    account.accountId,
    receipt.principalRef,
    receipt.tokenDigest,
    receipt.returnCorrelation,
    pending.linkRef,
    pending.deepLink,
  ])
    expect(exported.join("\n")).not.toContain(secret);
});
