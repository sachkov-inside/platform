import { randomUUID } from "node:crypto";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { learningHomeHttpSchema } from "../../src/modules/reading-activity/features/get-learning-home/get-learning-home.controller.js";
import { seriesContinuationHttpSchema } from "../../src/modules/reading-activity/features/get-series-continuation/get-series-continuation.controller.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

describe("ReadingActivity HTTP", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "api-key-1",
    };
    jwksServer = createServer((request, response) => {
      if (request.url !== "/jwks") return void response.writeHead(404).end();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (address === null || typeof address === "string") throw new Error("missing JWKS port");

    database = await createTestDatabase();
    await migrateToLatest(database.url);
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "accounts-api-test-email-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  test("trusted identity, personal no-store responses, conflict state, replay and bounded input", async () => {
    const token = await signToken();
    const token2 = await signToken({ subject: "another", email: "another@example.test" });
    const server = app.getHttpAdapter().getInstance();
    for (const bearer of [token, token2]) {
      expect((await server.inject({ method: "POST", url: "/accounts", headers: { authorization: `Bearer ${bearer}` } })).statusCode).toBe(201);
    }
    const topicId = randomUUID(); const formatId = "note"; const actor = randomUUID(); const seriesId = randomUUID();
    await database.prisma.topic.create({ data: { id: topicId, name: "Reading", slug: "reading" } });

    await database.prisma.guide.create({ data: { id: seriesId, name: "Series", slug: "series" } });
    const materials = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: () => true } });
    const created = await materials.authoring.createDraft({ actor, idempotencyKey: randomUUID(),
      metadata: { title: "Personal progress", summary: "HTTP test", access: "free", topicId, formatId, tagIds: [], seriesIds: [seriesId] },
      body: representativeDocument("Public content stays public."),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({ actor, materialId: created.value.materialId, expectedContentVersion: 1, publicationState: "published", idempotencyKey: randomUUID() });
    if (!published.ok) throw new Error(published.error.code);
    const materialId = published.value.materialId;
    const url = `/reading-activity/materials/${materialId}`;
    const payload = { commandId: randomUUID(), expectedVersion: 0, isRead: true };
    const headers = { authorization: `Bearer ${token}` };
    expect((await server.inject({ method: "PUT", url, payload })).statusCode).toBe(401);
    expect((await server.inject({ method: "PUT", url, headers, payload: { ...payload, accountId: randomUUID() } })).statusCode).toBe(400);
    const saved = await server.inject({ method: "PUT", url, headers, payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["cache-control"]).toBe("private, no-store");
    expect(saved.json()).toMatchObject({ changed: true, state: { materialId, isRead: true, version: 1 } });
    const stale = await server.inject({ method: "PUT", url, headers, payload: { ...payload, commandId: randomUUID() } });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers["content-type"]).toContain("application/problem+json");
    expect(stale.json()).toMatchObject({ code: "stale_version", current: { materialId, isRead: true, version: 1 } });
    const unmarked = await server.inject({ method: "PUT", url, headers, payload: { isRead: false, expectedVersion: 1, commandId: randomUUID() } });
    expect(unmarked.statusCode).toBe(200);
    const replay = await server.inject({ method: "PUT", url, headers, payload });
    expect(replay.json()).toMatchObject({ replayed: true, state: { isRead: true, version: 1 } });
    for (const [bearer, version] of [[token, 2], [token2, 0]] as const) {
      const states = await server.inject({ method: "POST", url: "/reading-activity/materials/query", headers: { authorization: `Bearer ${bearer}` }, payload: { materialIds: [materialId] } });
      expect(states.statusCode).toBe(200);
      expect(states.headers["cache-control"]).toBe("private, no-store");
      expect(states.json()).toMatchObject([{ materialId, isRead: false, version }]);
    }
    expect((await server.inject({ method: "POST", url: "/reading-activity/materials/query", headers, payload: { materialIds: Array.from({ length: 101 }, () => materialId) } })).statusCode).toBe(400);
    const progress = await server.inject({ method: "GET", url: `/reading-activity/series/${seriesId}`, headers });
    expect(progress.statusCode).toBe(200);
    expect(progress.headers["cache-control"]).toBe("private, no-store");
    expect(progress.json()).toEqual({ seriesId, read: 0, total: 1, allRead: false });
    const guideProgress = await server.inject({ method: "GET", url: `/reading-activity/guides/${seriesId}`, headers });
    expect(guideProgress.statusCode).toBe(200);
    expect(guideProgress.json()).toEqual(progress.json());
    expect(guideProgress.headers["cache-control"]).toBe("private, no-store");
    expect((await server.inject({ method: "GET", url: `/reading-activity/guides/${seriesId}` })).statusCode).toBe(401);
    const legacyPage = await server.inject({ method: "GET", url: "/library/series/series" });
    const guidePage = await server.inject({ method: "GET", url: "/library/guides/series" });
    expect(legacyPage.statusCode).toBe(200);
    expect(guidePage.statusCode).toBe(200);
    expect(guidePage.json()).toEqual(legacyPage.json());
    const openPayload = { materialId, contentVersion: published.value.contentVersion, commandId: randomUUID() };
    expect((await server.inject({ method: "GET", url: "/reading-activity/continue" })).statusCode).toBe(401);
    expect((await server.inject({ method: "POST", url: "/reading-activity/opens", payload: openPayload })).statusCode).toBe(401);
    expect((await server.inject({ method: "POST", url: "/reading-activity/opens", headers, payload: { ...openPayload, accountId: randomUUID() } })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: "/reading-activity/continue", headers })).json()).toEqual([]);
    const opened = await server.inject({ method: "POST", url: "/reading-activity/opens", headers, payload: openPayload });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers["cache-control"]).toBe("private, no-store");
    const continued = await server.inject({ method: "GET", url: "/reading-activity/continue", headers });
    expect(continued.statusCode).toBe(200);
    expect(continued.headers["cache-control"]).toBe("private, no-store");
    expect(continued.json()).toMatchObject([{ material: { materialId }, resume: { kind: "start" } }]);
    expect((await server.inject({ method: "GET", url: "/reading-activity/continue", headers: { authorization: `Bearer ${token2}` } })).json()).toEqual([]);
    expect((await server.inject({ method: "POST", url: "/reading-activity/opens", headers, payload: openPayload })).json()).toMatchObject({ replayed: true });
    const loaded = await materials.authoring.loadMaterial({ actor, materialId });
    if (!loaded.ok) throw new Error(loaded.error.code);
    // `toMatchObject` accepts a key the response was never meant to publish, so each body is also
    // read with the exact schema its controller declares. A projection that ships an undeclared key
    // still answers 200 here, while every strict reader of this API drops the whole body and shows
    // an account its progress as if there were none.
    const started = { read: 0, total: 1, continuation: { materialSlug: loaded.value.metadata.slug } };
    const unstarted = { read: 0, total: 1, continuation: null };
    for (const personalHome of [
      { url: "/reading-activity/learning-home", declared: learningHomeHttpSchema, own: { video: null, series: started }, other: { video: null, series: null } },
      { url: "/reading-activity/series-continuation/series", declared: seriesContinuationHttpSchema, own: started, other: unstarted },
      { url: "/reading-activity/guide-continuation/series", declared: seriesContinuationHttpSchema, own: started, other: unstarted },
    ]) {
      expect((await server.inject({ method: "GET", url: personalHome.url })).statusCode).toBe(401);
      const own = await server.inject({ method: "GET", url: personalHome.url, headers });
      expect(own.statusCode).toBe(200); expect(own.headers["cache-control"]).toBe("private, no-store");
      expect(own.json()).toMatchObject(personalHome.own);
      const other = await server.inject({ method: "GET", url: personalHome.url, headers: { authorization: `Bearer ${token2}` } });
      expect(other.json()).toMatchObject(personalHome.other);
      for (const body of [own.json(), other.json()] as unknown[]) expect(personalHome.declared.safeParse(body).error?.issues ?? []).toEqual([]);
    }
    expect((await server.inject({ method: "GET", url: "/reading-activity/series-continuation/missing", headers })).statusCode).toBe(404);

    const publicRead = await server.inject({ method: "GET", url: `/materials/${loaded.value.metadata.slug}` });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.body).not.toContain('"isRead"');
    expect(publicRead.body).not.toContain('"readAt"');
  });

  async function signToken(
    overrides: {
      readonly subject?: string;
      readonly clientId?: string;
      readonly email?: string;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "member@example.test",
      ...(overrides.clientId === undefined ? {} : { client_id: overrides.clientId }),
    })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(overrides.subject ?? "human-api-001")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
