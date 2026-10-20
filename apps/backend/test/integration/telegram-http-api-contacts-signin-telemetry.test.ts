import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { test, vi, type TestContext } from "vitest";
import { z } from "zod";
import { telegramContactsRequestSchema } from "@inside/contracts/telegram-contact";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { enrollPriorParticipantsFixture } from "./setup/prior-participants.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import {
  assembleEmailExportCapture,
  EMAIL_EXPORT_CAPTURE_LIMITS,
} from "./setup/email-export-capture.js";

registerFixedClock();

// Pure wire oracle: host negative witnesses exercise this same source before native execution.
const attributeSchema = z.strictObject({
  key: z.string(),
  value: z.union([
    z.strictObject({ stringValue: z.string() }),
    z.strictObject({ intValue: z.union([z.string(), z.number()]) }),
  ]),
});
const wireSpanSchema = z
  .object({
    traceId: z
      .string()
      .regex(/^[a-f0-9]{32}$/u)
      .refine((value) => value !== "0".repeat(32)),
    spanId: z
      .string()
      .regex(/^[a-f0-9]{16}$/u)
      .refine((value) => value !== "0".repeat(16)),
    parentSpanId: z.string().optional(),
    name: z.string(),
    kind: z.number(),
    attributes: z.array(attributeSchema),
    events: z.array(z.unknown()).optional(),
    links: z.array(z.unknown()).optional(),
  })
  .loose();
type WireSpan = z.infer<typeof wireSpanSchema>;
const pointSchema = z.object({
  attributes: z.array(attributeSchema),
  asDouble: z.number().optional(),
  count: z.union([z.number(), z.string()]).optional(),
});
const wireExportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(wireSpanSchema) })),
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
function attributes(items: z.infer<typeof attributeSchema>[]) {
  const result = Object.fromEntries(
    items.map(({ key, value }) => [
      key,
      "stringValue" in value ? value.stringValue : Number(value.intValue),
    ]),
  );
  assert.equal(
    Object.keys(result).length,
    items.length,
    "duplicate attributes",
  );
  return result;
}
function uniqueSpans(bodies: string[]) {
  const unique = new Map<string, WireSpan>();
  for (const body of bodies) {
    const document = wireExportSchema.parse(JSON.parse(body));
    for (const resource of document.resourceSpans ?? [])
      for (const scope of resource.scopeSpans)
        for (const span of scope.spans) {
          const key = `${span.traceId}/${span.spanId}`;
          if (unique.has(key))
            assert.deepEqual(
              span,
              unique.get(key),
              "conflicting duplicate span identity",
            );
          unique.set(key, span);
        }
  }
  return [...unique.values()];
}
// End pure wire oracle.

for (const mode of ["ON", "OFF", "503"] as const) {
  test(`native API Telegram contacts preserve Account isolation and optional404: ${mode}`, async (owner) => {
    await prove("contacts", mode, owner);
  });
  test(`native API Telegram sign-in preserves receipt ownership and terms-gated resume: ${mode}`, async (owner) => {
    await prove("signin", mode, owner);
  });
}

type Mode = "ON" | "OFF" | "503";
type Completion = {
  method: string;
  route: string;
  status: number;
  telegram: number;
  traceId?: string;
  spanId?: string;
};
const completePath = "/integrations/telegram/v1/sign-in/complete";
const resumePath = "/accounts/current/telegram-sign-in/resume";
const contactsPath = "/accounts/current/telegram-membership";
const secret = "private-telegram-api-integration-secret-sentinel";
const signInSecret = "private-telegram-api-signin-secret-sentinel";

async function prove(
  scenario: "contacts" | "signin",
  mode: Mode,
  owner: TestContext,
) {
  const cleanup: (() => unknown)[] = [];
  owner.onTestFinished(async () => {
    const failures: unknown[] = [];
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Owned Telegram API cleanup failed");
  });
  const database = await createMigratedTestDatabase();
  cleanup.push(() => database.dispose());
  const logRows: Record<string, unknown>[] = [];
  let logOverflow = false;
  for (const level of ["info", "warn", "error"] as const) {
    const spy = vi
      .spyOn(console, level)
      .mockImplementation((value: unknown) => {
        if (typeof value !== "string") return;
        if (Buffer.byteLength(value) > 8192 || logRows.length >= 512) {
          logOverflow = true;
          return;
        }
        if (!value.startsWith("{")) return;
        const parsed: unknown = JSON.parse(value);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        )
          logRows.push(z.record(z.string(), z.unknown()).parse(parsed));
      });
    cleanup.push(() => spy.mockRestore());
  }
  const capture = assembleEmailExportCapture();
  const requests = { traces: 0, metrics: 0, other: 0 };
  const responses = { traces: 0, metrics: 0, other: 0 };
  const privateValues = [
    secret,
    signInSecret,
    "private-telegram-api",
    "Private learner",
    "private_learner",
  ];
  async function listen(handler: RequestListener, collector = false) {
    const server = createServer(
      {
        highWaterMark: EMAIL_EXPORT_CAPTURE_LIMITS.highWaterMark,
        maxHeaderSize: EMAIL_EXPORT_CAPTURE_LIMITS.headerBytes,
      },
      handler,
    );
    server.maxConnections = EMAIL_EXPORT_CAPTURE_LIMITS.sockets;
    server.on("drop", () => capture.connectionSaturation());
    server.on("clientError", (_error, socket) => {
      capture.transportFailure();
      socket.destroy();
    });
    cleanup.push(async () => {
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
    const endpoint = `http://127.0.0.1:${address.port}`;
    if (!collector) privateValues.push(endpoint);
    return endpoint;
  }
  const collector = await listen((request, response) => {
    const signal =
      request.url === "/v1/traces"
        ? "traces"
        : request.url === "/v1/metrics"
          ? "metrics"
          : "other";
    requests[signal]++;
    response.on("finish", () => {
      responses[signal]++;
      if (response.statusCode !== (mode === "503" ? 503 : 200))
        capture.transportFailure();
    });
    response.on("error", () => capture.transportFailure());
    response.on("close", () => {
      if (!response.writableFinished) capture.transportFailure();
    });
    const body = capture.begin(request.url ?? "");
    if (body === undefined) {
      request.destroy();
      return;
    }
    request.on("data", (chunk: Buffer) => {
      if (!body.write(chunk)) request.destroy();
    });
    request.on("aborted", () => body.abort());
    request.on("error", () => {
      body.abort();
      capture.transportFailure();
    });
    request.on("close", () => {
      if (!request.complete) body.abort();
    });
    request.on("end", () => {
      body.complete();
      response
        .writeHead(mode === "503" ? 503 : 200, {
          "content-type": "application/json",
          "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT",
        })
        .end("{}");
    });
  }, true);
  let nativeRequests = 0;
  const nativeBodies: string[] = [];
  const handlerFailures: unknown[] = [];
  const handlers = new Set<Promise<void>>();
  // Listener shutdown precedes draining its independently observed DB reads; DB outlives both.
  cleanup.push(async () => {
    await Promise.allSettled([...handlers]);
  });
  let expectedContact:
    { accountRef: string; telegramIdentityRef: string } | undefined;
  const subjectRef = randomUUID();
  const requestRef = randomUUID();
  const telegramIdentityRef = randomUUID();
  const bindPrincipals: string[] = [];
  const provider = await listen((request, response) => {
    nativeRequests++;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body) > 16384) request.destroy();
    });
    request.on("end", () => {
      const handling = (async () => {
        assert.equal(request.method, "POST");
        assert.equal(
          request.headers.authorization,
          `Bearer ${scenario === "contacts" ? secret : signInSecret}`,
        );
        assert.equal(request.headers["content-type"], "application/json");
        for (const header of ["traceparent", "tracestate", "baggage"])
          assert.equal(request.headers[header], undefined);
        nativeBodies.push(body);
        if (scenario === "contacts") {
          assert.equal(
            request.url,
            "/integrations/platform/v1/telegram-contacts",
          );
          assert.ok(expectedContact);
          assert.deepEqual(
            telegramContactsRequestSchema.parse(JSON.parse(body)),
            {
              contractVersion: "inside.telegram-contact.v1",
              contacts: [expectedContact],
            },
          );
          if (nativeBodies.length === 2) {
            response.writeHead(404).end();
            return;
          }
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              contractVersion: "inside.telegram-contact.v1",
              contacts: [
                {
                  ...expectedContact,
                  status: "available",
                  displayName: "Private learner",
                  username: "private_learner",
                },
              ],
            }),
          );
        } else {
          assert.equal(
            request.url,
            `/integrations/identity/v1/sign-in/${requestRef}/account-link`,
          );
          const command = z
            .strictObject({
              contractVersion: z.literal("inside.bot-sign-in.v1"),
              subjectRef: z.uuid(),
              accountRef: z.uuid(),
            })
            .parse(JSON.parse(body));
          assert.equal(command.subjectRef, subjectRef);
          const receipt =
            await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
              where: { principalRef: command.accountRef },
            });
          const account = await database.prisma.account.findUniqueOrThrow({
            where: { id: receipt.accountId },
          });
          assert.equal(
            account.logtoSubject,
            "private-telegram-api-signin-owner",
          );
          assert.equal(account.telegramSubjectRef, subjectRef);
          assert.equal(receipt.linkRef, requestRef);
          assert.equal(receipt.status, "registering");
          assert.equal(receipt.returnCorrelation, requestRef);
          bindPrincipals.push(command.accountRef);
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              contractVersion: "inside.bot-sign-in.v1",
              status: "linked",
              telegramIdentityRef,
            }),
          );
        }
      })();
      handlers.add(handling);
      void handling
        .catch((error: unknown) => {
          handlerFailures.push(error);
          response.destroy();
        })
        .finally(() => handlers.delete(handling));
    });
  });
  let jwksRequests = 0;
  const identity = await startTestIdentityIssuer({
    issuer: "https://telegram-api-frontier.example.test/oidc",
    audience: "https://api.telegram-frontier.example.test",
    onJwksRequest: () => {
      jwksRequests++;
    },
  });
  cleanup.push(() => identity.close());
  cleanup.push(() => vi.unstubAllEnvs());
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  vi.stubEnv("INSIDE_OTEL_ENABLED", mode === "OFF" ? "false" : "true");
  vi.stubEnv("INSIDE_OTEL_ENDPOINT", collector);
  vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "1");
  const config = parsePlatformConfig({
    NODE_ENV: "test",
    DATABASE_URL: database.url,
    LOGTO_ISSUER: identity.issuer,
    LOGTO_AUDIENCE: identity.audience,
    LOGTO_JWKS_URL: identity.jwksUrl,
    IDENTITY_EMAIL_FINGERPRINT_KEY: "private-telegram-api-fingerprint-key",
    TELEGRAM_BOT_START_URL: "https://t.me/inside_proof_bot",
    TELEGRAM_LINKING_ENDPOINT:
      provider + "/integrations/platform/v1/identity-links",
    TELEGRAM_LINKING_SECRET: secret,
    ...(scenario === "signin"
      ? {
          TELEGRAM_SIGN_IN_ENABLED: "true",
          TELEGRAM_SIGN_IN_PROVIDER_URL: provider,
          TELEGRAM_SIGN_IN_INTEGRATION_SECRET: signInSecret,
        }
      : {}),
  });
  assert.equal(config.communications, undefined);
  assert.equal(config.communityEntitlements, undefined);
  let application: NestFastifyApplication | undefined;
  cleanup.push(async () => {
    await application?.close();
  });
  application = await createApiApplication(config, { logger: false });
  await application.listen(0, "127.0.0.1");
  const endpoint = await application.getUrl();
  privateValues.push(endpoint);
  const completions: Completion[] = [];
  async function request(
    method: "GET" | "POST",
    route: string,
    token?: string,
    payload?: unknown,
    telegram = 0,
  ) {
    const before = logRows.length;
    if (payload !== undefined) {
      privateValues.push(JSON.stringify(payload));
      for (const [key, value] of Object.entries(
        z.record(z.string(), z.unknown()).parse(payload),
      ))
        if (typeof value === "string" && /(?:Id|Ref|digest)$/u.test(key))
          privateValues.push(value);
    }
    const response = await fetch(endpoint + route, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(20_000),
    });
    const body: unknown = await response.json();
    assertDeclaredResponse({
      method,
      url: route,
      status: response.status,
      body: () => body,
    });
    const logged = logRows
      .slice(before)
      .filter((row) => row["event"] === "request_completed");
    assert.equal(
      logged.length,
      1,
      "one real API completion per caller request",
    );
    const row = logged[0];
    assert.ok(row);
    assert.equal(row["route"], route);
    assert.equal(row["statusCode"], response.status);
    z.uuid().parse(row["requestId"]);
    completions.push({
      method,
      route,
      status: response.status,
      telegram,
      ...(mode === "OFF"
        ? {}
        : {
            traceId: z
              .string()
              .regex(/^[a-f0-9]{32}$/u)
              .parse(row["traceId"]),
            spanId: z
              .string()
              .regex(/^[a-f0-9]{16}$/u)
              .parse(row["spanId"]),
          }),
    });
    return { status: response.status, body };
  }
  async function acceptTerms(token: string, accountId: string) {
    await enrollPriorParticipantsFixture(database.prisma, accountId);
    const reading = await request(
      "GET",
      "/accounts/current/legal-acceptances/terms",
      token,
    );
    assert.equal(reading.status, 200);
    const { document } = z
      .object({
        document: z.object({ version: z.string(), digest: z.string() }),
      })
      .parse(reading.body);
    assert.equal(
      (
        await request(
          "POST",
          "/accounts/current/legal-acceptances/terms",
          token,
          {
            operationId: randomUUID(),
            version: document.version,
            digest: document.digest,
            buttonLabel: "Принять условия и продолжить",
          },
        )
      ).status,
      200,
    );
  }
  if (scenario === "contacts") {
    assert.equal((await request("GET", contactsPath)).status, 401);
    const ownerToken = await identity.sign(
      "private-telegram-api-contact-owner",
      { inside_verified_email: "private-telegram-api-owner@example.invalid" },
    );
    const otherToken = await identity.sign(
      "private-telegram-api-contact-other",
      { inside_verified_email: "private-telegram-api-other@example.invalid" },
    );
    privateValues.push(ownerToken, otherToken);
    async function establish(token: string) {
      const response = await request("POST", "/accounts", token);
      assert.equal(response.status, 201);
      const { account } = z
        .object({ account: z.object({ accountId: z.uuid() }) })
        .parse(response.body);
      privateValues.push(account.accountId);
      await acceptTerms(token, account.accountId);
      return account.accountId;
    }
    const accountId = await establish(ownerToken);
    await establish(otherToken);
    // Explicit linked-receipt AND current-projection preconditions. Baseline register/confirm cases own their construction flow.
    const principalRef = await linkTelegramAccount(database.prisma, {
      accountId,
      identityRef: telegramIdentityRef,
      now: new Date(fixedTestInstant()),
    });
    const receipt =
      await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
        where: { principalRef },
      });
    await database.prisma.telegramAccountLinkState.create({
      data: {
        accountId,
        linkRef: receipt.linkRef,
        revision: 1,
        principalRef,
        identityRef: telegramIdentityRef,
        updatedAt: new Date(fixedTestInstant()),
      },
    });
    expectedContact = { accountRef: principalRef, telegramIdentityRef };
    privateValues.push(
      principalRef,
      telegramIdentityRef,
      receipt.linkRef,
      receipt.tokenDigest,
      receipt.returnCorrelation,
    );
    const snapshots = async () => ({
      receipt: await database.prisma.telegramLinkTransaction.findMany(),
      bindings: await database.prisma.membershipBinding.findMany(),
      current: await database.prisma.telegramAccountLinkState.findMany(),
      permissions: await database.prisma.accountPermission.findMany(),
    });
    const before = await snapshots();
    const other = await request("GET", contactsPath, otherToken);
    assert.equal(other.status, 200);
    assert.deepEqual(
      z.object({ contact: z.unknown() }).parse(other.body).contact,
      { state: "not_linked", displayName: null, username: null },
    );
    assert.equal(nativeRequests, 0);
    const available = await request(
      "GET",
      contactsPath,
      ownerToken,
      undefined,
      1,
    );
    assert.equal(available.status, 200);
    assert.deepEqual(
      z.object({ contact: z.unknown() }).parse(available.body).contact,
      {
        state: "available",
        displayName: "Private learner",
        username: "private_learner",
      },
    );
    const unavailable = await request(
      "GET",
      contactsPath,
      ownerToken,
      undefined,
      1,
    );
    assert.equal(unavailable.status, 200);
    assert.deepEqual(
      z.object({ contact: z.unknown() }).parse(unavailable.body).contact,
      { state: "unavailable", displayName: null, username: null },
    );
    const presentation = z.object({
      link: z.unknown(),
      membership: z.unknown(),
    });
    assert.deepEqual(
      presentation.parse(unavailable.body),
      presentation.parse(available.body),
    );
    assert.deepEqual(await snapshots(), before);
    assert.equal(nativeBodies[0], nativeBodies[1]);
  } else {
    const claims = { inside_telegram_sign_in: { subjectRef, requestRef } };
    const token = await identity.sign(
      "private-telegram-api-signin-owner",
      claims,
    );
    const refreshed = await identity.sign("private-telegram-api-signin-owner");
    const foreignRequestRef = randomUUID();
    privateValues.push(foreignRequestRef);
    const foreign = await identity.sign("private-telegram-api-signin-foreign", {
      inside_telegram_sign_in: { subjectRef, requestRef: foreignRequestRef },
    });
    const emailOnly = await identity.sign("private-telegram-api-email-only", {
      inside_verified_email: "private-telegram-api-email@example.invalid",
    });
    const wrongAudience = await identity.sign(
      "private-telegram-api-signin-owner",
      claims,
      "https://wrong-audience.example.test",
    );
    privateValues.push(
      token,
      refreshed,
      foreign,
      emailOnly,
      wrongAudience,
      subjectRef,
      requestRef,
      telegramIdentityRef,
    );
    for (const rejected of [undefined, wrongAudience, emailOnly])
      assert.equal((await request("POST", completePath, rejected)).status, 401);
    assert.equal(nativeRequests, 0);
    assert.equal(await database.prisma.account.count(), 0);
    assert.equal(await database.prisma.telegramLinkTransaction.count(), 0);
    const first = await request("POST", completePath, token, undefined, 1);
    assert.equal(first.status, 200);
    const {
      account: { accountId },
    } = z
      .object({ account: z.object({ accountId: z.uuid() }) })
      .parse(first.body);
    const receipt =
      await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
        where: { linkRef: requestRef },
      });
    privateValues.push(accountId, receipt.principalRef, receipt.tokenDigest);
    assert.equal(receipt.accountId, accountId);
    assert.equal(receipt.status, "registering");
    assert.equal(receipt.providerIdentityRef, telegramIdentityRef);
    assert.equal(receipt.providerTransactionRef, requestRef);
    assert.equal(await database.prisma.membershipBinding.count(), 0);
    assert.equal(await database.prisma.accountPermission.count(), 0);
    assert.equal((await request("POST", completePath, foreign)).status, 409);
    assert.equal((await request("POST", resumePath)).status, 401);
    assert.equal((await request("POST", resumePath, refreshed)).status, 403);
    assert.equal(nativeRequests, 1);
    const otherEstablished = await request("POST", "/accounts", emailOnly);
    assert.equal(otherEstablished.status, 201);
    const otherAccount = z
      .object({ account: z.object({ accountId: z.uuid() }) })
      .parse(otherEstablished.body).account;
    privateValues.push(otherAccount.accountId);
    await acceptTerms(emailOnly, otherAccount.accountId);
    // The ordinary Account credential, not caller-supplied identifiers, selects whose receipt may resume.
    const otherResume = await request("POST", resumePath, emailOnly, {
      accountId,
      principalRef: receipt.principalRef,
    });
    assert.equal(otherResume.status, 200);
    assert.deepEqual(otherResume.body, { account: otherAccount });
    assert.equal(nativeRequests, 1);
    assert.equal(await database.prisma.membershipBinding.count(), 0);
    assert.deepEqual(
      await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
        where: { linkRef: requestRef },
      }),
      receipt,
    );
    await acceptTerms(refreshed, accountId);
    assert.equal(
      (await request("POST", resumePath, refreshed, undefined, 1)).status,
      200,
    );
    const linked =
      await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
        where: { linkRef: requestRef },
      });
    assert.equal(linked.status, "linked");
    for (const key of [
      "accountId",
      "principalRef",
      "tokenDigest",
      "returnCorrelation",
      "providerTransactionRef",
      "providerIdentityRef",
    ] as const)
      assert.equal(linked[key], receipt[key]);
    const bindings = await database.prisma.membershipBinding.findMany();
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]?.accountId, accountId);
    assert.equal(bindings[0].principalRef, receipt.principalRef);
    assert.equal((await request("POST", resumePath, refreshed)).status, 200);
    assert.equal(nativeRequests, 2);
    assert.equal(await database.prisma.account.count(), 2);
    assert.equal(await database.prisma.telegramLinkTransaction.count(), 1);
    assert.equal(await database.prisma.accountPermission.count(), 0);
    const storedAccount = await database.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    assert.equal(storedAccount.telegramSubjectRef, subjectRef);
    assert.equal(storedAccount.emailFingerprint, null);
    assert.deepEqual(bindPrincipals, [
      receipt.principalRef,
      receipt.principalRef,
    ]);
    assert.equal(nativeBodies[0], nativeBodies[1]);
  }
  assert.equal(nativeRequests, 2);
  assert.equal(nativeBodies.length, 2);
  assert.deepEqual(handlerFailures, []);
  assert.equal(jwksRequests, 1);
  await application.close();
  application = undefined;
  assert.equal(logOverflow, false);
  capture.assertComplete(requests);
  assert.deepEqual(responses, requests);
  const bodies = capture.payloads();
  if (mode === "OFF") {
    assert.deepEqual(bodies, []);
    assert.deepEqual(requests, { traces: 0, metrics: 0, other: 0 });
    return;
  }
  const spans = uniqueSpans(bodies);
  assertNativeWire(spans, bodies, completions, scenario);
  const raw = bodies.join("\n");
  for (const value of [
    ...privateValues,
    "authorization",
    "baggage",
    "tracestate",
    "tokenDigest",
    "returnCorrelation",
    "displayName",
    "telegramIdentityRef",
    "subjectRef",
  ])
    assert.equal(
      raw.includes(value),
      false,
      "private fixture value escaped to OTLP",
    );
  const failedExports = logRows.filter(
    (row) => row["event"] === "telemetry_export_failed",
  );
  if (mode === "503") {
    assert.ok(capture.entries().some((entry) => entry.multiplicity > 1));
    assert.ok(failedExports.some((row) => row["signal"] === "traces"));
    assert.ok(failedExports.some((row) => row["signal"] === "metrics"));
  } else assert.deepEqual(failedExports, []);
}

function assertNativeWire(
  spans: WireSpan[],
  bodies: string[],
  completions: Completion[],
  scenario: "contacts" | "signin",
) {
  const server = spans.filter((span) => span.kind === 2);
  assert.equal(server.length, completions.length);
  const telegram = spans.filter((span) => span.name.startsWith("telegram "));
  assert.equal(telegram.length, 2);
  const jwks = spans.filter((span) => span.name === "logto jwks");
  assert.equal(jwks.length, 1);
  assert.ok(spans.some((span) => span.name === "postgresql query"));
  for (const completion of completions) {
    const parent = server.find(
      (span) =>
        span.traceId === completion.traceId &&
        span.spanId === completion.spanId,
    );
    assert.ok(parent, "real request log identifies SERVER");
    assert.equal(parent.name, `${completion.method} ${completion.route}`);
    assert.deepEqual(attributes(parent.attributes), {
      "http.request.method": completion.method,
      "http.route": completion.route,
      "http.request.outcome": "completed",
      "http.response.status_code": completion.status,
    });
    assert.equal(
      telegram.filter(
        (span) =>
          span.traceId === parent.traceId &&
          span.parentSpanId === parent.spanId,
      ).length,
      completion.telegram,
    );
    if (completion.telegram === 0)
      assert.equal(
        telegram.filter((span) => span.traceId === parent.traceId).length,
        0,
      );
  }
  const outcomes: string[] = [];
  for (const span of spans) {
    assert.deepEqual(span.events ?? [], []);
    assert.deepEqual(span.links ?? [], []);
    const attrs = attributes(span.attributes);
    if (span.kind === 2) continue;
    assert.equal(span.kind, 3);
    const parent = server.find(
      (item) =>
        item.traceId === span.traceId && item.spanId === span.parentSpanId,
    );
    assert.ok(
      parent,
      "all dependency observations belong to actual API requests",
    );
    if (
      span.name === "postgresql query" ||
      span.name === "postgresql acquire"
    ) {
      assert.deepEqual(attrs, {
        "dependency.name": "postgresql",
        "dependency.operation": span.name.slice(11),
        "dependency.outcome": "completed",
      });
    } else if (span.name === "logto jwks") {
      assert.deepEqual(attrs, {
        "dependency.name": "logto",
        "dependency.operation": "jwks",
        "dependency.outcome": "completed",
        "http.request.method": "GET",
        "http.response.status_code": 200,
      });
    } else {
      assert.equal(
        span.name,
        scenario === "contacts"
          ? "telegram contacts.read"
          : "telegram signin.bindAccount",
      );
      const outcome = attrs["dependency.outcome"];
      const status = attrs["http.response.status_code"];
      assert.deepEqual(attrs, {
        "dependency.name": "telegram",
        "dependency.operation":
          scenario === "contacts" ? "contacts.read" : "signin.bindAccount",
        "dependency.outcome": outcome,
        "http.request.method": "POST",
        "http.response.status_code": status,
      });
      assert.equal(outcome, status === 200 ? "completed" : "failed");
      assert.ok(status === 200 || (scenario === "contacts" && status === 404));
      assert.ok(
        (scenario === "contacts"
          ? [contactsPath]
          : [completePath, resumePath]
        ).includes(String(attributes(parent.attributes)["http.route"])),
      );
      outcomes.push(outcome);
    }
  }
  assert.deepEqual(
    outcomes.sort(),
    scenario === "contacts"
      ? ["completed", "failed"]
      : ["completed", "completed"],
  );
  for (const metricName of [
    "inside.dependency.operations",
    "inside.dependency.duration",
  ]) {
    const maxima = new Map<string, number>();
    for (const body of bodies)
      for (const resource of wireExportSchema.parse(JSON.parse(body))
        .resourceMetrics ?? [])
        for (const scope of resource.scopeMetrics)
          for (const metric of scope.metrics) {
            if (metric.name !== metricName) continue;
            for (const point of metric.sum?.dataPoints ??
              metric.histogram?.dataPoints ??
              []) {
              const attrs = attributes(point.attributes);
              assert.deepEqual(Object.keys(attrs).sort(), [
                "dependency",
                "operation",
                "outcome",
              ]);
              assert.ok(
                ["telegram", "logto", "postgresql"].includes(
                  String(attrs["dependency"]),
                ),
              );
              assert.ok(
                ["completed", "failed"].includes(String(attrs["outcome"])),
              );
              if (attrs["dependency"] === "logto") {
                assert.equal(attrs["operation"], "jwks");
                assert.equal(attrs["outcome"], "completed");
                continue;
              }
              if (attrs["dependency"] === "postgresql") {
                assert.ok(
                  ["query", "acquire"].includes(String(attrs["operation"])),
                );
                assert.equal(attrs["outcome"], "completed");
                continue;
              }
              assert.equal(
                attrs["operation"],
                scenario === "contacts"
                  ? "contacts.read"
                  : "signin.bindAccount",
              );
              const value =
                metricName === "inside.dependency.operations"
                  ? point.asDouble
                  : Number(point.count);
              assert.ok(
                typeof value === "number" &&
                  Number.isSafeInteger(value) &&
                  value > 0,
              );
              const key = String(attrs["outcome"]);
              maxima.set(key, Math.max(maxima.get(key) ?? 0, value));
            }
          }
    assert.deepEqual(
      Object.fromEntries(maxima),
      scenario === "contacts" ? { completed: 1, failed: 1 } : { completed: 2 },
    );
  }
}
