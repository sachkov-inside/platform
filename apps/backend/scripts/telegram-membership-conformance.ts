import "reflect-metadata";

import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

import { parsePlatformConfig } from "../src/config/platform-config.js";
import { seedLocalDevelopment } from "../src/development/seed-local-development.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { createPrismaClient } from "../src/infrastructure/prisma/index.js";
import { migrateToLatest } from "../src/migrations/index.js";
import {
  localProofDatabaseUrl,
  loopbackHttpUrl,
} from "./conformance-safety.js";

const platformPort = port("CONFORMANCE_PLATFORM_PORT", 44_101);
const platformBase = `http://127.0.0.1:${String(platformPort)}`;
const telegramBase = loopbackHttpUrl(
  required("CONFORMANCE_TELEGRAM_URL"),
  "CONFORMANCE_TELEGRAM_URL",
);
const telegramControlBase = loopbackHttpUrl(
  required("CONFORMANCE_TELEGRAM_CONTROL_URL"),
  "CONFORMANCE_TELEGRAM_CONTROL_URL",
);
const evidenceSecret = required("CONFORMANCE_EVIDENCE_SECRET");
const linkSecret = required("CONFORMANCE_LINK_SECRET");
const webhookSecret = required("CONFORMANCE_WEBHOOK_SECRET");
const controlSecret = required("CONFORMANCE_CONTROL_SECRET");
const issuer = "https://identity.telegram-conformance.invalid/oidc";
const audience = "https://api.telegram-conformance.invalid";
const databaseUrl = localProofDatabaseUrl(
  required("DATABASE_URL"),
  "DATABASE_URL",
);

const prisma = createPrismaClient(databaseUrl);
let application: Awaited<ReturnType<typeof createApiApplication>> | undefined;
let jwksServer: Server | undefined;

try {
  await waitFor(
    `${telegramBase}/health`,
    (response) => response.status === 200,
  );
  const pair = await generateKeyPair("ES384");
  const publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    alg: "ES384",
    kid: "telegram-conformance-key",
  };
  jwksServer = createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await listen(jwksServer);

  await migrateToLatest(databaseUrl);
  await seedLocalDevelopment(prisma);
  application = await createApiApplication(
    parsePlatformConfig({
      API_HOST: "127.0.0.1",
      API_PORT: String(platformPort),
      DATABASE_URL: databaseUrl,
      IDENTITY_EMAIL_FINGERPRINT_KEY:
        "telegram-conformance-email-fingerprint-key",
      LOGTO_AUDIENCE: audience,
      LOGTO_ISSUER: issuer,
      LOGTO_JWKS_URL: serverUrl(jwksServer, "/jwks"),
      MEMBERSHIP_ACQUISITION_URL: "https://t.me/tribute/app?startapp=inside",
      NODE_ENV: "test",
      TELEGRAM_BOT_START_URL: "https://t.me/inside_proof_bot",
      TELEGRAM_EVIDENCE_INGRESS_SECRET: evidenceSecret,
      TELEGRAM_LINKING_ENDPOINT: `${telegramBase}/integrations/platform/v1/identity-links`,
      TELEGRAM_LINKING_SECRET: linkSecret,
      TELEGRAM_LINK_LIFETIME_SECONDS: "600",
    }),
    { logger: false },
  );
  await application.listen(platformPort, "127.0.0.1");

  const first = await establishAccount("member-account", pair.privateKey);
  assertKind(
    await readMembershipMaterial(first.token),
    "teaser",
    "link alone must remain locked",
  );
  const firstLink = await linkAccount(first.token, 42, 1_001);
  assertKind(
    await waitForMaterial(first.token, "available"),
    "available",
    "fresh member evidence must allow",
  );

  const removalAt = await nextEpochSecond();
  await postWebhook(subjectUpdate(1_101, 42, "left", removalAt));
  await waitForMaterial(first.token, "teaser");
  await postWebhook(subjectUpdate(1_102, 42, "member", removalAt - 1));
  await pause(1_000);
  assertKind(
    await readMembershipMaterial(first.token),
    "teaser",
    "older replay must not restore access",
  );

  const rejoinAt = await nextEpochSecond();
  await postWebhook(subjectUpdate(1_103, 42, "member", rejoinAt));
  await waitForMaterial(first.token, "available");
  const versionBeforeDuplicate = await projectionVersion(first.accountId);
  await postWebhook(subjectUpdate(1_103, 42, "member", rejoinAt));
  await pause(1_000);
  assert(
    (await projectionVersion(first.accountId)) === versionBeforeDuplicate,
    "duplicate Telegram update changed the Platform projection",
  );

  const principalRef = await principalFor(first.accountId);
  const versionBeforeRejections = await projectionVersion(first.accountId);
  assert(
    (await evidenceRequest(
      "wrong-secret",
      "conformance-invalid-auth",
      unsupportedEvidence(principalRef),
    )) === 401,
    "invalid evidence auth was not rejected",
  );
  assert(
    (await evidenceRequest(
      evidenceSecret,
      "conformance-invalid-version",
      unsupportedEvidence(principalRef),
    )) === 400,
    "unsupported contract was not rejected",
  );
  assert(
    (await projectionVersion(first.accountId)) === versionBeforeRejections,
    "rejected evidence changed the current projection",
  );

  await setTelegramState({ subjectState: "left" });
  const nonMember = await establishAccount(
    "non-member-account",
    pair.privateKey,
  );
  await linkAccount(nonMember.token, 43, 2_001);
  await waitForMaterial(nonMember.token, "teaser");

  const duplicate = await establishAccount(
    "duplicate-account",
    pair.privateKey,
  );
  const duplicateState = await linkAccount(
    duplicate.token,
    42,
    3_001,
    "recovery-required",
  );
  assert(
    duplicateState.status === "recovery-required",
    "duplicate identity did not require recovery",
  );

  await setTelegramState({ botState: "unavailable", subjectState: "member" });
  await postWebhook(providerUpdate(4_001, "member", await nextEpochSecond()));
  const activeProjection = await prisma.membershipProjection.findUniqueOrThrow({
    where: { accountId: first.accountId },
  });
  process.stdout.write(
    `Waiting for real evidence expiry at ${activeProjection.validUntil.toISOString()}\n`,
  );
  await waitUntil(activeProjection.validUntil.getTime() + 250);
  first.token = await signToken("member-account", pair.privateKey);
  await waitForMaterial(first.token, "teaser");

  let callsBefore = await telegramCallCount();
  let expiredRead = await readMembershipMaterial(first.token);
  let callsAfter = await telegramCallCount();
  for (
    let attempt = 0;
    callsAfter !== callsBefore && attempt < 5;
    attempt += 1
  ) {
    await pause(600);
    callsBefore = await telegramCallCount();
    expiredRead = await readMembershipMaterial(first.token);
    callsAfter = await telegramCallCount();
  }
  assertKind(expiredRead, "teaser", "expired evidence must fail closed");
  assert(
    callsAfter === callsBefore,
    "Platform content request triggered a Telegram membership read",
  );

  await setTelegramState({
    botState: "administrator",
    subjectState: "member",
  });
  await postWebhook(
    providerUpdate(4_002, "administrator", await nextEpochSecond()),
  );
  await postWebhook(
    subjectUpdate(4_003, 42, "member", await nextEpochSecond()),
  );
  await waitForMaterial(first.token, "available");

  const receipts = await prisma.membershipEvidenceReceipt.findMany({
    orderBy: { receivedAt: "asc" },
    select: { outcome: true, source: true },
  });
  const summary = {
    assertions: {
      authenticatedAccountBinding: true,
      duplicateIdentityRequiresRecovery: true,
      duplicateUpdateIsIdempotent: true,
      expiredEvidenceDeniesLocally: true,
      initialMemberAllows: true,
      invalidAuthRejected: true,
      linkAloneDenies: true,
      newerRemovalDenies: true,
      nonMemberDenies: true,
      olderReplayCannotRestore: true,
      providerRecoveryRestores: true,
      rejoinRestores: true,
      schemaVersionRejected: true,
      userRequestTelegramCalls: callsAfter - callsBefore,
    },
    firstLinkStatus: firstLink.status,
    platform: {
      evidenceReceipts: receipts.length,
      linkTransactions: await prisma.telegramLinkTransaction.count(),
      projections: await prisma.membershipProjection.count(),
      receiptOutcomes: counts(receipts.map(({ outcome }) => outcome)),
      receiptSources: counts(receipts.map(({ source }) => source)),
    },
    proofVersion: "inside.telegram-platform-conformance.v1",
  };
  process.stdout.write(`CONFORMANCE_RESULT ${JSON.stringify(summary)}\n`);
} finally {
  await application?.close();
  await prisma.$disconnect();
  if (jwksServer) {
    await close(jwksServer);
  }
}

async function establishAccount(
  subject: string,
  privateKey: CryptoKey,
): Promise<{ accountId: string; token: string }> {
  const token = await signToken(subject, privateKey);
  const response = await request("/accounts", { method: "POST", token });
  assert(
    response.status === 201 || response.status === 200,
    `Account establish failed: ${String(response.status)} ${JSON.stringify(response.body)}`,
  );
  const account = record(record(response.body).account);
  assert(typeof account.accountId === "string", "Account response has no id");
  return { accountId: account.accountId, token };
}

async function linkAccount(
  token: string,
  telegramUserId: number,
  updateId: number,
  expectedStatus = "linked",
): Promise<Record<string, unknown>> {
  const begun = await request("/accounts/current/telegram-link", {
    method: "POST",
    token,
  });
  assert(begun.status === 200, "begin-link failed");
  const pending = record(begun.body);
  assert(
    typeof pending.deepLink === "string",
    "begin-link returned no deep link",
  );
  assert(
    typeof pending.linkRef === "string",
    "begin-link returned no link ref",
  );
  const rawToken = new URL(pending.deepLink).searchParams.get("start");
  assert(rawToken !== null, "deep link returned no bearer");
  await postWebhook(startUpdate(updateId, telegramUserId, rawToken));
  return waitForLink(token, pending.linkRef, expectedStatus);
}

async function waitForLink(
  token: string,
  linkRef: string,
  expectedStatus: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await request(
      `/accounts/current/telegram-link/${encodeURIComponent(linkRef)}/confirm`,
      { method: "POST", token },
    );
    assert(response.status === 200, "confirm-link failed");
    const state = record(response.body);
    if (state.status === expectedStatus) {
      return state;
    }
    if (state.status !== "pending") {
      throw new Error(`Unexpected link status: ${String(state.status)}`);
    }
    await pause(250);
  }
  throw new Error(`Timed out waiting for link status ${expectedStatus}`);
}

async function readMembershipMaterial(
  token: string,
): Promise<Record<string, unknown>> {
  const response = await request(
    "/materials/developer-pipeline-bez-poteri-konteksta",
    { method: "GET", token },
  );
  assert(response.status === 200, "Material read failed");
  return record(response.body);
}

async function waitForMaterial(
  token: string,
  kind: "available" | "teaser",
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const material = await readMembershipMaterial(token);
    if (material.kind === kind) {
      return material;
    }
    await pause(250);
  }
  throw new Error(`Timed out waiting for Material kind ${kind}`);
}

async function request(
  path: string,
  options: { method: "GET" | "POST"; token?: string },
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(`${platformBase}${path}`, {
    ...(options.token
      ? { headers: { authorization: `Bearer ${options.token}` } }
      : {}),
    method: options.method,
  });
  return { body: await response.json(), status: response.status };
}

async function postWebhook(payload: unknown): Promise<void> {
  const response = await fetch(`${telegramBase}/webhooks/telegram`, {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": webhookSecret,
    },
    method: "POST",
  });
  assert(
    response.status === 202,
    `Telegram webhook returned ${String(response.status)}`,
  );
}

async function setTelegramState(state: Record<string, string>): Promise<void> {
  const response = await fetch(`${telegramControlBase}/state`, {
    body: JSON.stringify(state),
    headers: {
      authorization: `Bearer ${controlSecret}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert(response.ok, "Telegram conformance control failed");
}

async function telegramCallCount(): Promise<number> {
  const response = await fetch(`${telegramControlBase}/state`, {
    headers: { authorization: `Bearer ${controlSecret}` },
  });
  const body = record(await response.json());
  assert(
    typeof body.calls === "number",
    "Conformance control has no call count",
  );
  return body.calls;
}

async function evidenceRequest(
  secret: string,
  deliveryId: string,
  evidence: unknown,
): Promise<number> {
  const response = await fetch(
    `${platformBase}/integrations/telegram/v1/membership-evidence`,
    {
      body: JSON.stringify(evidence),
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": deliveryId,
        "x-inside-membership-evidence-source": "reconciliation",
      },
      method: "POST",
    },
  );
  return response.status;
}

async function principalFor(accountId: string): Promise<string> {
  const transaction = await prisma.telegramLinkTransaction.findFirstOrThrow({
    where: { accountId },
  });
  return transaction.principalRef;
}

async function projectionVersion(accountId: string): Promise<string> {
  const projection = await prisma.membershipProjection.findUniqueOrThrow({
    where: { accountId },
  });
  return projection.evidenceVersion.toString();
}

function unsupportedEvidence(principalRef: string) {
  const now = new Date();
  return {
    checkedAt: now.toISOString(),
    contractVersion: "inside.membership-evidence.v2",
    decision: "member",
    evidenceRef: "unsupported-conformance-ref",
    evidenceVersion: 999,
    principalRef,
    reasonCode: "chat_member",
    telegramIdentityRef: "unsupported-conformance-identity",
    validUntil: new Date(now.getTime() + 60_000).toISOString(),
  };
}

function startUpdate(updateId: number, userId: number, rawToken: string) {
  return {
    update_id: updateId,
    message: {
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false },
      message_id: updateId,
      text: `/start ${rawToken}`,
    },
  };
}

function subjectUpdate(
  updateId: number,
  userId: number,
  status: "left" | "member",
  date: number,
) {
  return {
    update_id: updateId,
    chat_member: {
      chat: { id: -1_000_000_000_000, type: "supergroup" },
      date,
      from: { id: 777, is_bot: false },
      new_chat_member: { status, user: { id: userId, is_bot: false } },
      old_chat_member: {
        status: status === "member" ? "left" : "member",
        user: { id: userId, is_bot: false },
      },
    },
  };
}

function providerUpdate(
  updateId: number,
  status: "administrator" | "member",
  date: number,
) {
  return {
    update_id: updateId,
    my_chat_member: {
      chat: { id: -1_000_000_000_000, type: "supergroup" },
      date,
      from: { id: 777, is_bot: false },
      new_chat_member: { status, user: { id: 999, is_bot: true } },
      old_chat_member: {
        status: status === "administrator" ? "member" : "administrator",
        user: { id: 999, is_bot: true },
      },
    },
  };
}

async function signToken(
  subject: string,
  privateKey: CryptoKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ inside_verified_email: `${subject}@example.test` })
    .setProtectedHeader({ alg: "ES384", kid: "telegram-conformance-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function nextEpochSecond(): Promise<number> {
  const current = Math.floor(Date.now() / 1_000);
  while (Math.floor(Date.now() / 1_000) === current) {
    await pause(25);
  }
  return Math.floor(Date.now() / 1_000);
}

async function waitUntil(timestamp: number): Promise<void> {
  while (Date.now() < timestamp) {
    const remaining = timestamp - Date.now();
    process.stdout.write(`Evidence expiry remaining: ${String(remaining)}ms\n`);
    await pause(Math.min(30_000, remaining));
  }
}

async function waitFor(
  url: string,
  predicate: (response: Response) => boolean,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (predicate(response)) {
        return;
      }
    } catch {
      // The independently started process is still booting.
    }
    await pause(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function assertKind(
  value: Record<string, unknown>,
  kind: string,
  message: string,
): void {
  assert(value.kind === kind, `${message}: ${JSON.stringify(value)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function record(value: unknown): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Expected object",
  );
  return Object.fromEntries(Object.entries(value));
}

function counts(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid port`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function serverUrl(server: Server, pathname: string): string {
  const address = server.address();
  assert(
    address !== null && typeof address !== "string",
    "Server is not listening",
  );
  return `http://127.0.0.1:${String(address.port)}${pathname}`;
}
