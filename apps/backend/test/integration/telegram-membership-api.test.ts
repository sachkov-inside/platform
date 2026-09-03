import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.telegram-membership.test/oidc";
const audience = "https://api.telegram-membership.test";
const evidenceSecret = "telegram-evidence-api-test-secret";
const linkingSecret = "telegram-linking-api-test-secret";

describe("Telegram Membership API", () => {
  let app: NestFastifyApplication;
  let database: TestDatabase;
  let jwksServer: Server;
  let privateKey: CryptoKey;
  let provider: ControlledTelegramProvider;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "telegram-membership-api-key",
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

    provider = new ControlledTelegramProvider();
    await provider.start();
    database = await createTestDatabase();
    await migrateToLatest(database.url);
    app = await createApiApplication(
      parsePlatformConfig({
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL: database.url,
        IDENTITY_EMAIL_FINGERPRINT_KEY:
          "telegram-membership-api-email-fingerprint-key",
        LOGTO_AUDIENCE: audience,
        LOGTO_ISSUER: issuer,
        LOGTO_JWKS_URL: serverUrl(jwksServer, "/jwks"),
        MEMBERSHIP_ACQUISITION_URL: "https://t.me/tribute/inside",
        MEMBERSHIP_SUPPORT_URL: "https://t.me/inside_support",
        NODE_ENV: "test",
        TELEGRAM_BOT_START_URL: "https://t.me/inside_test_bot",
        TELEGRAM_EVIDENCE_INGRESS_SECRET: evidenceSecret,
        TELEGRAM_LINKING_ENDPOINT: provider.endpoint,
        TELEGRAM_LINKING_SECRET: linkingSecret,
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await close(jwksServer);
    await provider.stop();
  });

  test("requires an authenticated Account and confirms only its original transaction", async () => {
    const ownerToken = await signToken("telegram-link-owner");
    const ownerAccountId = readAccountId(
      (await establish(ownerToken)).json<unknown>(),
    );

    const unauthenticatedPresentation = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/accounts/current/telegram-membership",
      });
    expect(unauthenticatedPresentation.statusCode).toBe(401);

    const initialPresentation = await authenticated(
      "GET",
      "/accounts/current/telegram-membership",
      ownerToken,
    );
    expect(initialPresentation.statusCode).toBe(200);
    expect(initialPresentation.headers["cache-control"]).toBe(
      "private, no-store",
    );
    expect(initialPresentation.json()).toEqual({
      link: { kind: "unlinked" },
      membership: {
        acquisitionUrl: "https://t.me/tribute/inside",
        kind: "inactive",
      },
    });

    const unauthenticated = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/accounts/current/telegram-link",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const begun = await authenticated(
      "POST",
      "/accounts/current/telegram-link",
      ownerToken,
    );
    expect(begun.statusCode).toBe(200);
    expect(begun.headers["cache-control"]).toBe("private, no-store");
    const pending = readPendingLink(begun.json<unknown>());
    expect(pending.deepLink).toMatch(
      /^https:\/\/t\.me\/inside_test_bot\?start=[A-Za-z0-9_-]{43}$/u,
    );
    expect(provider.registrations).toHaveLength(1);
    const linkingPresentation = await authenticated(
      "GET",
      "/accounts/current/telegram-membership",
      ownerToken,
    );
    expect(linkingPresentation.json()).toMatchObject({
      link: { kind: "linking", linkRef: pending.linkRef },
      membership: { kind: "inactive" },
    });
    expect(provider.registrations[0]?.authorization).toBe(
      `Bearer ${linkingSecret}`,
    );
    expect(provider.registrations[0]?.body).not.toHaveProperty("token");
    expect(provider.registrations[0]?.body.accountRef).not.toBe(ownerAccountId);

    const otherToken = await signToken("telegram-link-other");
    await establish(otherToken);
    const wrongAccount = await authenticated(
      "POST",
      `/accounts/current/telegram-link/${pending.linkRef}/confirm`,
      otherToken,
    );
    expect(wrongAccount.statusCode).toBe(404);
    expect(provider.confirmations).toHaveLength(0);

    const confirmed = await authenticated(
      "POST",
      `/accounts/current/telegram-link/${pending.linkRef}/confirm`,
      ownerToken,
    );
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      linkRef: pending.linkRef,
      status: "linked",
    });
    expect(provider.confirmations).toHaveLength(1);
    const linkedPresentation = await authenticated(
      "GET",
      "/accounts/current/telegram-membership",
      ownerToken,
    );
    expect(linkedPresentation.json()).toEqual({
      link: { kind: "linked" },
      membership: { kind: "unavailable" },
    });
    expect(JSON.stringify(linkedPresentation.json())).not.toMatch(
      /accountId|checkedAt|evidence|issuer|subject|telegramIdentity|username|validUntil/iu,
    );
  });

  test("authenticates durable evidence ingestion and applies no business state on rejection", async () => {
    const ownerToken = await signToken("telegram-evidence-owner");
    await establish(ownerToken);
    const begun = await authenticated(
      "POST",
      "/accounts/current/telegram-link",
      ownerToken,
    );
    const pending = readPendingLink(begun.json<unknown>());
    const principalRef = provider.registrations.at(-1)?.body.accountRef;
    if (typeof principalRef !== "string") {
      throw new TypeError("Provider registration has no principalRef");
    }
    const checkedAt = new Date();
    const memberEvidence = evidence(principalRef, checkedAt);
    const receiptsBefore = await database.prisma.membershipEvidenceReceipt.count();

    const unauthenticated = await deliver(memberEvidence, {
      authorization: "Bearer wrong-secret",
      deliveryId: "api-evidence-unauthenticated",
      source: "link_time",
    });
    expect(unauthenticated.statusCode).toBe(401);
    await expect(
      database.prisma.membershipEvidenceReceipt.count(),
    ).resolves.toBe(receiptsBefore);

    const beforeConfirmation = await deliver(memberEvidence, {
      authorization: `Bearer ${evidenceSecret}`,
      deliveryId: "api-evidence-member-v1",
      source: "link_time",
    });
    expect(beforeConfirmation.statusCode).toBe(503);
    await expect(
      database.prisma.membershipEvidenceReceipt.count(),
    ).resolves.toBe(receiptsBefore);

    await authenticated(
      "POST",
      `/accounts/current/telegram-link/${pending.linkRef}/confirm`,
      ownerToken,
    );
    const accepted = await deliver(memberEvidence, {
      authorization: `Bearer ${evidenceSecret}`,
      deliveryId: "api-evidence-member-v1",
      source: "link_time",
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["cache-control"]).toBe("private, no-store");
    expect(accepted.json()).toMatchObject({
      ok: true,
      outcome: "applied",
      state: "active",
    });
    const duplicate = await deliver(memberEvidence, {
      authorization: `Bearer ${evidenceSecret}`,
      deliveryId: "api-evidence-member-v1",
      source: "link_time",
    });
    expect(duplicate.statusCode).toBe(200);

    const unsupported = await deliver(
      { ...memberEvidence, contractVersion: "inside.membership-evidence.v2" },
      {
        authorization: `Bearer ${evidenceSecret}`,
        deliveryId: "api-evidence-unsupported",
        source: "reconciliation",
      },
    );
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ code: "unsupported_contract" });
    const projection = await database.prisma.membershipProjection.findFirst();
    expect(projection?.evidenceVersion).toBe(1n);

    const providerModelLeak = await deliver(
      { ...memberEvidence, telegramUserId: "42" },
      {
        authorization: `Bearer ${evidenceSecret}`,
        deliveryId: "api-evidence-provider-model",
        source: "member_status_event",
      },
    );
    expect(providerModelLeak.statusCode).toBe(400);
    const serializedReceipts = JSON.stringify(
      await database.prisma.membershipEvidenceReceipt.findMany(),
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    );
    expect(serializedReceipts).not.toContain("telegramUserId");
  });

  function authenticated(
    method: "GET" | "POST",
    url: string,
    token: string,
  ) {
    return app.getHttpAdapter().getInstance().inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  function establish(token: string) {
    return authenticated("POST", "/accounts", token);
  }

  function deliver(
    payload: Record<string, unknown>,
    headers: {
      readonly authorization: string;
      readonly deliveryId: string;
      readonly source: string;
    },
  ) {
    return app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/integrations/telegram/v1/membership-evidence",
      headers: {
        authorization: headers.authorization,
        "idempotency-key": headers.deliveryId,
        "x-inside-membership-evidence-source": headers.source,
      },
      payload,
    });
  }

  async function signToken(subject: string): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: `${subject}@example.test`,
    })
      .setProtectedHeader({
        alg: "ES384",
        kid: "telegram-membership-api-key",
      })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});

class ControlledTelegramProvider {
  readonly confirmations: unknown[] = [];
  readonly registrations: {
    readonly authorization: string | undefined;
    readonly body: Record<string, unknown>;
  }[] = [];
  readonly server = createServer((request, response) => {
    void this.respond(request, response);
  });

  get endpoint(): string {
    return serverUrl(this.server, "/integrations/platform/v1/identity-links");
  }

  start(): Promise<void> {
    return listen(this.server);
  }

  stop(): Promise<void> {
    return close(this.server);
  }

  private async respond(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJsonObject(request);
    response.setHeader("content-type", "application/json");
    if (request.url === "/integrations/platform/v1/identity-links") {
      this.registrations.push({
        authorization: request.headers.authorization,
        body,
      });
      response.end(
        JSON.stringify({
          contractVersion: "inside.identity-linking.v1",
          expiresAt: body.expiresAt,
          linkTransactionRef: `provider-${String(this.registrations.length)}`,
          returnCorrelation: body.returnCorrelation,
          status: "pending",
        }),
      );
      return;
    }
    if (request.url?.endsWith("/confirm") === true) {
      this.confirmations.push(body);
      const providerRef = request.url.split("/").at(-2);
      response.end(
        JSON.stringify({
          contractVersion: "inside.identity-linking.v1",
          linkTransactionRef: providerRef,
          returnCorrelation: body.returnCorrelation,
          status: "linked",
          telegramIdentityRef: `telegram-identity-${String(this.confirmations.length)}`,
        }),
      );
      return;
    }
    response.writeHead(404).end();
  }
}

function readPendingLink(value: unknown): {
  readonly deepLink: string;
  readonly linkRef: string;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("deepLink" in value) ||
    typeof value.deepLink !== "string" ||
    !("linkRef" in value) ||
    typeof value.linkRef !== "string"
  ) {
    throw new TypeError("Telegram link response is not pending");
  }
  return { deepLink: value.deepLink, linkRef: value.linkRef };
}

function evidence(principalRef: string, checkedAt: Date) {
  return {
    checkedAt: checkedAt.toISOString(),
    contractVersion: "inside.membership-evidence.v1",
    decision: "member",
    evidenceRef: "api-evidence-ref-1",
    evidenceVersion: 1,
    principalRef,
    reasonCode: "chat_member",
    telegramIdentityRef: "telegram-identity-1",
    validUntil: new Date(checkedAt.getTime() + 5 * 60_000).toISOString(),
  };
}

async function readJsonObject(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

function serverUrl(server: Server, pathname: string): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server is not listening");
  }
  return `http://127.0.0.1:${String(address.port)}${pathname}`;
}

function readAccountId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("account" in value) ||
    typeof value.account !== "object" ||
    value.account === null ||
    !("accountId" in value.account) ||
    typeof value.account.accountId !== "string"
  ) {
    throw new TypeError("Accounts response has no AccountId");
  }
  return value.account.accountId;
}
