import { VIDEOS, type Videos } from "../src/modules/videos/index.js";
import "reflect-metadata";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";
import { parsePlatformConfig } from "../src/config/platform-config.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { createMcpHttpServer } from "../src/entrypoints/mcp/mcp-http-server.js";
import { createPrismaClient } from "../src/infrastructure/prisma/index.js";
import { OperationalReadiness } from "../src/infrastructure/operational-readiness.js";
import { migrateToLatest } from "../src/migrations/index.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  bootstrapOwnerAccount,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../src/modules/accounts/index.js";
import {
  MATERIAL_AUTHORING,
  type MaterialAuthoring,
} from "../src/modules/materials/index.js";
import { BillingOperations } from "../src/modules/billing/index.js";
import { Communications } from "../src/modules/communications/index.js";
import { TrackingVisits } from "../src/modules/communications/facets/tracking-visits/tracking-visits.js";
import {
  communicationsResultSchema,
  managementRequestSchema,
  type ManagementRequest,
} from "../src/modules/communications/communications-contract.js";
import {
  contentSchema,
  deliverySchema,
} from "../src/modules/communications/communications-schema.generated.js";
import {
  localProofDatabaseUrl,
  loopbackHttpUrl,
} from "./conformance-safety.js";

// Real consumer and provider communicate only over HTTP; no neighboring code or database imports.
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty =
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim().length > 0;
const databaseUrl = localProofDatabaseUrl(
  process.env.DATABASE_URL ?? "",
  "DATABASE_URL",
);
const provider = loopbackHttpUrl(
  process.env.CONFORMANCE_TELEGRAM_URL ?? "http://127.0.0.1:44112",
  "CONFORMANCE_TELEGRAM_URL",
);
const control = loopbackHttpUrl(
  process.env.CONFORMANCE_TELEGRAM_CONTROL_URL ?? "http://127.0.0.1:44113",
  "CONFORMANCE_TELEGRAM_CONTROL_URL",
);
const issuer = "https://communications.conformance.invalid/oidc";
const audience = "https://communications.conformance.invalid/api";
const origin = "https://inside.example";
const prisma = createPrismaClient(databaseUrl);
await migrateToLatest(databaseUrl);
const key = await generateKeyPair("ES384");
const jwks = Fastify();
jwks.get("/jwks", () => ({
  keys: [{ ...publicKey, alg: "ES384", kid: "proof" }],
}));
const publicKey = await exportJWK(key.publicKey);
const jwksUrl = await jwks.listen({ host: "127.0.0.1", port: 0 });
const app = await createApiApplication(
  parsePlatformConfig({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    LOGTO_ISSUER: issuer,
    LOGTO_AUDIENCE: audience,
    LOGTO_JWKS_URL: `${jwksUrl}/jwks`,
    TELEGRAM_COMMUNICATIONS_ENDPOINT: `${provider}/integrations/platform/v1/communications`,
    TELEGRAM_COMMUNICATIONS_SECRET: "synthetic_communications_secret",
    TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "synthetic-bot",
    TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN: origin,
    TELEGRAM_TRACKING_ORIGIN: origin,
    TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "synthetic_authorization_secret",
  }),
  { logger: false },
);
const accounts = new Map<string, string>();
for (const subject of ["owner", "ordinary"]) {
  const owner = await bootstrapOwnerAccount(prisma, { issuer, subject });
  accounts.set(subject, owner.accountId);
  if (subject === "owner")
    await bootstrapOwnerAccount(
      prisma,
      { issuer, subject },
      "communications:manage",
    );
  await prisma.telegramLinkTransaction.create({
    data: {
      linkRef: randomUUID(),
      accountId: owner.accountId,
      principalRef: `proof-${subject}`,
      providerIdentityRef: `identity-${subject}`,
      providerTransactionRef: randomUUID(),
      returnCorrelation: randomUUID(),
      tokenDigest: randomBytes(32).toString("base64url"),
      status: "linked",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}
await app.listen(44111, "127.0.0.1");
const mcp = createMcpHttpServer({
  accounts: app.get<Accounts>(ACCOUNTS),
  authoring: app.get<MaterialAuthoring>(MATERIAL_AUTHORING),
      videos: app.get<Videos>(VIDEOS),
  communications: app.get(Communications),
      billing: app.get(BillingOperations),
  tokenVerifier: app.get<LogtoAccessTokenVerifier>(LOGTO_ACCESS_TOKEN_VERIFIER),
  identityIssuer: issuer,
  config: { host: "127.0.0.1", port: 0, serverUrl: "http://127.0.0.1:0/mcp" },
  readiness: app.get(OperationalReadiness),
});
const endpoint = await mcp.listen();
const client = new Client({ name: "communications-conformance", version: "1" });

function token(subject: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES384", kid: "proof" })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key.privateKey);
}
function command(
  operation: string,
  payload: unknown,
  expectedRevision = 0,
): ManagementRequest {
  return managementRequestSchema.parse({
    contractVersion: "inside-communications-v1",
    operation,
    operationId: randomUUID(),
    expectedRevision,
    payload,
  });
}
async function execute(
  input: ManagementRequest,
  transport: "http" | "mcp" = "http",
  subject = "owner",
) {
  if (transport === "mcp") {
    const { contractVersion: _version, operation, ...args } = input;
    const result = await client.callTool({
      name: `communications_${operation.replaceAll(".", "_")}`,
      arguments: args,
    });
    return communicationsResultSchema.parse(result.structuredContent);
  }
  const response = await app.inject({
    method: "POST",
    url: "/communications",
    headers: { authorization: `Bearer ${await token(subject)}` },
    payload: input,
  });
  if (response.statusCode !== 200) {
    const problem = z
      .object({ code: z.string(), status: z.number() })
      .parse(response.json<unknown>());
    assert.equal(problem.status, response.statusCode);
    return communicationsResultSchema.parse({
      ok: false,
      error: { code: problem.code },
    });
  }
  return communicationsResultSchema.parse(response.json<unknown>());
}
async function ok(
  input: ManagementRequest,
  transport: "http" | "mcp" = "http",
) {
  const result = await execute(input, transport);
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
async function controlCall(payload: unknown) {
  const response = await fetch(`${control}/tick`, {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic_control_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
const stateSchema = z.object({
  now: z.iso.datetime(),
  simulated: z.literal(true),
  revision: z.string(),
  dirty: z.boolean(),
  sent: z.array(z.object({ chatId: z.string(), content: contentSchema })),
});
async function state() {
  const r = await fetch(`${control}/state`, {
    headers: { authorization: "Bearer synthetic_control_secret" },
  });
  assert.equal(r.status, 200);
  return stateSchema.parse(await r.json());
}
let updateId = 10000;
async function entry(text = "/start", user = 42) {
  const response = await fetch(`${provider}/webhooks/telegram`, {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": "synthetic_webhook",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 1893456000,
        chat: { id: user, type: "private" },
        from: { id: user, is_bot: false, first_name: "Synthetic" },
        text,
      },
    }),
  });
  assert.equal(response.status, 202);
  await controlCall({ limit: 0 });
}
const text = (value: string) => ({
  type: "text" as const,
  text: value,
  entities: [],
  buttons: [],
});
const part = (value: string) => ({
  partId: randomUUID(),
  content: text(value),
});
async function readFunnel(funnelId: string) {
  const result = await ok(command("funnels.read", { funnelId }));
  assert("funnel" in result);
  return result.funnel;
}
async function deliveries(funnelId: string) {
  const result = await ok(command("deliveries.read", { funnelId }));
  assert("deliveries" in result);
  return z.array(deliverySchema).parse(result.deliveries);
}
const passed: string[] = [];
function pass(name: string) {
  passed.push(name);
  process.stdout.write(`PASS ${name}\n`);
}
try {
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      authProvider: { token: () => token("owner") },
    }),
  );
  await state();
  assert.equal((await fetch(`${control}/state`)).status, 401);
  assert.equal(
    (
      await fetch(`${control}/tick`, {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic_control_secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ advanceSeconds: -1 }),
      })
    ).status,
    400,
  );
  const actor = z.string().parse(accounts.get("owner"));
  const authoring = app.get<MaterialAuthoring>(MATERIAL_AUTHORING);
  const topicId = randomUUID(),
    formatId = "guide",
    seriesId = randomUUID();
  await prisma.topic.create({
    data: { id: topicId, slug: "proof-topic", name: "Synthetic proof" },
  });

  await prisma.guide.create({
    data: { id: seriesId, slug: "telegram-proof", name: "Тестовая серия #310" },
  });
  const metadata = {
    title: "Тестовый материал Telegram #310",
    summary: "Synthetic acceptance fixture, not author production content",
    access: "free" as const,
    topicId,
    formatId,
    tagIds: [],
    seriesIds: [seriesId],
  };
  const body = {
    schemaVersion: 1 as const,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Явный тестовый бесплатный материал сквозной приёмки.",
            },
          ],
        },
      ],
    },
  };
  const created = await authoring.createDraft({
    actor,
    idempotencyKey: randomUUID(),
    metadata,
    body,
  });
  assert(created.ok);
  const materialId = created.value.materialId;
  await prisma.material.update({
    where: { id: materialId },
    data: { slug: "telegram-proof" },
  });
  let contentVersion = 1;
  async function saveTarget(
    access: "free" | "membership",
    publicationState: "published" | "unpublished",
  ) {
    const saved = await authoring.saveMaterial({
      actor,
      materialId,
      expectedContentVersion: contentVersion,
      idempotencyKey: randomUUID(),
      metadata: { ...metadata, access },
      body,
      publicationState,
    });
    assert(saved.ok, JSON.stringify(saved));
    contentVersion = saved.value.contentVersion;
  }
  await saveTarget("free", "published");
  const materialUrl = `${origin}/materials/telegram-proof`,
    seriesUrl = `${origin}/series/telegram-proof`;
  const response = await app.inject({ url: "/materials/telegram-proof" });
  assert.equal(response.statusCode, 200);
  assert.equal(
    z.object({ kind: z.string() }).parse(response.json<unknown>()).kind,
    "available",
  );
  assert.equal(
    (await app.inject({ url: "/library/series/telegram-proof" })).statusCode,
    200,
  );
  pass(
    "published synthetic free Material and Series through real content routes",
  );
  await ok(
    command("intro.save", {
      introId: randomUUID(),
      parts: [part("shared intro")],
    }),
    "mcp",
  );
  const mediaParts = [];
  for (const type of [
    "text",
    "photo",
    "video",
    "video_note",
    "voice",
    "document",
  ] as const) {
    const content = contentSchema.parse({
      ...text(type === "video_note" ? "" : `Synthetic ${type}`),
      type,
      ...(type === "text" ? {} : { fileId: `synthetic-${type}-file` }),
    });
    const templateId = randomUUID();
    const result = await ok(
      command("templates.save", { templateId, content }),
      "mcp",
    );
    assert("template" in result);
    mediaParts.push({ partId: randomUUID(), content: result.template.content });
  }
  pass("all six media template IDs authored through delegated MCP");
  const draft = {
    funnelId: randomUUID(),
    name: "Synthetic standard",
    isDefault: true,
    sources: [
      { sourceId: randomUUID(), code: "m_proof", name: "Synthetic source" },
    ],
    entryResponse: {
      stepId: randomUUID(),
      parts: [
        {
          partId: randomUUID(),
          content: {
            ...text("Read synthetic content"),
            buttons: [
              { text: "Material", url: materialUrl },
              { text: "Series", url: seriesUrl },
            ],
          },
        },
      ],
    },
    steps: [{ stepId: randomUUID(), delaySeconds: 10, parts: mediaParts }],
  };
  await ok(command("funnels.save", draft));
  await ok(command("funnels.preview", { funnelId: draft.funnelId }, 1), "mcp");
  await ok(command("funnels.publish", { funnelId: draft.funnelId }, 1), "mcp");
  const denied = await execute(
    command("funnels.publish", { funnelId: draft.funnelId }, 2),
    "http",
    "ordinary",
  );
  assert(!denied.ok && denied.error.code === "forbidden");
  await entry();
  for (let i = 0; i < 10; i++) await controlCall({ advanceSeconds: 15 });
  const sent = (await state()).sent;
  assert.equal(sent.filter((m) => m.content.text === "shared intro").length, 1);
  for (const type of [
    "text",
    "photo",
    "video",
    "video_note",
    "voice",
    "document",
  ])
    assert(sent.some((m) => m.content.type === type));
  await entry("/start m_proof");
  await controlCall({ advanceSeconds: 5 });
  assert.equal(
    (await state()).sent.filter((m) => m.content.text === "shared intro")
      .length,
    1,
  );
  pass(
    "HTTP/MCP publish, ordinary denial, webhook start, common intro once, six simulated sends",
  );
  // Historical target must be checked even when the current draft has no such link.
  await ok(
    command(
      "funnels.save",
      {
        ...draft,
        entryResponse: {
          ...draft.entryResponse,
          parts: [part("current safe content")],
        },
      },
      2,
    ),
  );
  await ok(command("funnels.publish", { funnelId: draft.funnelId }, 3));
  for (const transport of ["http", "mcp"] as const) {
    for (const unavailable of ["unpublished", "paid"] as const) {
      await saveTarget(
        unavailable === "paid" ? "membership" : "free",
        unavailable === "paid" ? "published" : "unpublished",
      );
      const rejected = await execute(
        command(
          "funnels.rollback",
          { funnelId: draft.funnelId, publishedRevision: 2 },
          4,
        ),
        transport,
      );
      assert(
        !rejected.ok && rejected.error.code === "unsupported_content",
        JSON.stringify(rejected),
      );
      assert.equal((await readFunnel(draft.funnelId)).revision, 4);
    }
  }
  await saveTarget("free", "published");
  const rollback = command(
    "funnels.rollback",
    { funnelId: draft.funnelId, publishedRevision: 2 },
    4,
  );
  const restored = await ok(rollback, "mcp");
  await saveTarget("membership", "published");
  assert.deepEqual(await ok(rollback), restored);
  const stale = await execute({ ...rollback, operationId: randomUUID() });
  assert(!stale.ok && stale.error.code === "revision_conflict");
  const protectedResponse = await app.inject({
    url: "/materials/telegram-proof",
  });
  assert.equal(
    z.object({ kind: z.string() }).parse(protectedResponse.json<unknown>())
      .kind,
    "teaser",
  );
  await saveTarget("free", "published");
  pass(
    "historical rollback unpublished/paid denied via HTTP and MCP; receipt replay and content access preserved",
  );
  const tracked = sent
    .flatMap((m) => m.content.buttons)
    .find((b) => b.url.startsWith(`${origin}/c`));
  assert(tracked);
  const trackingToken = new URL(tracked.url).searchParams.get("token");
  assert(trackingToken);
  const tracking = app.get(TrackingVisits);
  assert.equal(
    (await tracking.resolve({ token: trackingToken, traffic: "unknown" })).kind,
    "resolved",
  );
  assert.equal(
    (await tracking.resolve({ token: trackingToken, traffic: "unknown" })).kind,
    "resolved",
  );
  await tracking.deliverPending();
  const stats = await ok(command("statistics.read", {}), "mcp");
  assert("statistics" in stats);
  assert.equal(stats.statistics.trackingHits, 2);
  assert.equal(stats.statistics.uniqueTokensWithHits, 1);
  pass(
    "forwarded/repeated opaque tracking token counts hits separately from recipients",
  );
  // A completed participant receives newly published steps; stop suppresses overdue additions.
  let current = await readFunnel(draft.funnelId);
  const added = {
    stepId: randomUUID(),
    delaySeconds: 30,
    parts: [part("addition C")],
  };
  await ok(
    command(
      "funnels.save",
      { ...draft, steps: [...draft.steps, added] },
      current.revision,
    ),
  );
  current = await readFunnel(draft.funnelId);
  await ok(
    command("funnels.publish", { funnelId: draft.funnelId }, current.revision),
  );
  await controlCall({ advanceSeconds: 29 });
  assert(!(await state()).sent.some((m) => m.content.text === "addition C"));
  await controlCall({ advanceSeconds: 1 });
  assert((await state()).sent.some((m) => m.content.text === "addition C"));
  await entry("/stop");
  current = await readFunnel(draft.funnelId);
  const missed = {
    stepId: randomUUID(),
    delaySeconds: 10,
    parts: [part("suppressed D")],
  };
  await ok(
    command(
      "funnels.save",
      { ...draft, steps: [...draft.steps, added, missed] },
      current.revision,
    ),
  );
  current = await readFunnel(draft.funnelId);
  await ok(
    command("funnels.publish", { funnelId: draft.funnelId }, current.revision),
  );
  await controlCall({ advanceSeconds: 20 });
  await entry("/resume");
  await controlCall({ advanceSeconds: 20 });
  assert(!(await state()).sent.some((m) => m.content.text === "suppressed D"));
  pass(
    "addition to completed audience at publish delay; stop/resume without backlog",
  );
  // Unknown sends remain blocked until the operator resolves that exact part.
  const unknownId = randomUUID();
  await ok(
    command("broadcasts.save", {
      broadcastId: unknownId,
      audience: { kind: "all" },
      scheduledAt: null,
      parts: [part("unknown broadcast")],
    }),
    "mcp",
  );
  await ok(command("broadcasts.launch", { broadcastId: unknownId }, 1), "mcp");
  await controlCall({
    advanceSeconds: 5,
    outcome: "transport_unknown",
    limit: 1,
  });
  await controlCall({ advanceSeconds: 120, outcome: "delivered" });
  assert.equal(
    (await state()).sent.filter((m) => m.content.text === "unknown broadcast")
      .length,
    1,
  );
  const unknownResult = await ok(
    command("deliveries.read", { broadcastId: unknownId }),
  );
  assert("deliveries" in unknownResult);
  const unknown = unknownResult.deliveries.find((d) =>
    d.parts.some((p) => p.state === "unknown"),
  );
  assert(unknown);
  const unknownPart = unknown.parts.find((p) => p.state === "unknown");
  assert(unknownPart);
  await ok(
    command(
      "delivery.resolve",
      {
        deliveryId: unknown.deliveryId,
        partId: unknownPart.partId,
        action: "skip",
        duplicateRiskAccepted: false,
      },
      unknown.revision,
    ),
    "mcp",
  );
  const resolved = await ok(
    command("deliveries.read", { deliveryId: unknown.deliveryId }),
  );
  assert("deliveries" in resolved);
  assert.equal(resolved.deliveries[0]?.parts[0]?.state, "skipped");
  assert.deepEqual(
    resolved.deliveries[0]?.parts[0]?.attempts,
    unknownPart.attempts,
  );
  pass(
    "unknown has no automatic resend; delegated explicit skip preserves attempt evidence",
  );
  const broadcastId = randomUUID();
  const scheduledAt = new Date(
    +new Date((await state()).now) + 600_000,
  ).toISOString();
  await ok(
    command("broadcasts.save", {
      broadcastId,
      audience: { kind: "all" },
      scheduledAt,
      parts: [part("scheduled broadcast")],
    }),
  );
  const launch = command("broadcasts.launch", { broadcastId }, 1);
  const scheduled = await ok(launch, "mcp");
  assert.deepEqual(await ok(launch), scheduled);
  await entry("/start", 43);
  for (let i = 0; i < 20; i++) await controlCall({ advanceSeconds: 15 });
  await controlCall({ advanceSeconds: 300, outcome: "retry_after", limit: 1 });
  const launched = await ok(command("broadcasts.read", { broadcastId }));
  assert("broadcast" in launched);
  assert.equal(launched.broadcast.snapshotSize, 2);
  assert.equal(
    (await state()).sent.filter((m) => m.content.text === "scheduled broadcast")
      .length,
    1,
  );
  await entry("/start", 44);
  await entry("/stop", 42);
  await entry("/stop", 43);
  await entry("/resume", 42);
  await entry("/resume", 43);
  await controlCall({ advanceSeconds: 60, outcome: "delivered" });
  assert.equal(
    (await state()).sent.filter((m) => m.content.text === "scheduled broadcast")
      .length,
    1,
  );
  const stopped = await ok(command("deliveries.read", { broadcastId }));
  assert("deliveries" in stopped);
  assert.equal(stopped.deliveries.length, 2);
  assert(
    stopped.deliveries.every((d) =>
      d.parts.every((p) => ["cancelled", "suppressed"].includes(p.state)),
    ),
  );
  pass(
    "scheduled actual-launch snapshot, replay, late join exclusion, stop/resume before 429 retry stays suppressed",
  );
  const beforeDisable = (await state()).sent.length;
  await controlCall({ advanceSeconds: 60, marketingEnabled: false });
  assert.equal((await state()).sent.length, beforeDisable);
  pass("feature disable prevents new marketing dispatch");
  const snapshot = await deliveries(draft.funnelId);
  assert(snapshot.length > 0);
  const providerState = await state();
  process.stdout.write(
    JSON.stringify({
      simulated: true,
      consumerRevision: revision,
      consumerDirty: dirty,
      providerRevision: providerState.revision,
      providerDirty: providerState.dirty,
      passed,
      credentialedTelegram: "NOT TESTED",
    }) + "\n",
  );
} finally {
  await client.close();
  await mcp.close();
  await app.close();
  await jwks.close();
  await prisma.$disconnect();
}
