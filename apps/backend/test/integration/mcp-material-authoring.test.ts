import { VIDEOS, type Videos } from "../../src/modules/videos/index.js";
import { Communications } from "../../src/modules/communications/index.js";
import { createServer, type Server } from "node:http";

import type { INestApplicationContext } from "@nestjs/common";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createMcpApplication } from "../../src/entrypoints/create-mcp-application.js";
import { createMcpHttpServer, type McpHttpServer } from "../../src/entrypoints/mcp/mcp-http-server.js";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import {
  ACCOUNTS,
  bootstrapOwnerAccount,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../../src/modules/accounts/index.js";
import {
  MATERIAL_AUTHORING,
  type MaterialAuthoring,
} from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.mcp.test/oidc";
const audience = "https://api.mcp.test";
const ownerSubject = "mcp-owner-001";
const topicId = "92000000-0000-4000-8000-000000000001";
const formatId = "guide";

describe("delegated Material authoring over MCP", () => {
  let application: INestApplicationContext;
  let client: Client;
  let database: TestDatabase;
  let jwksServer: Server;
  let mcpServer: McpHttpServer;
  let ownerAccountId: string;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "mcp-integration-key",
    };
    jwksServer = createServer((request, response) => {
      if (request.url !== "/jwks") {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, "127.0.0.1", resolve),
    );
    const jwksAddress = jwksServer.address();
    if (jwksAddress === null || typeof jwksAddress === "string") {
      throw new Error("MCP integration JWKS server has no TCP port");
    }

    database = await createMigratedTestDatabase();
    const owner = await bootstrapOwnerAccount(database.prisma, {
      issuer,
      subject: ownerSubject,
    });
    ownerAccountId = owner.accountId;
    await Promise.all([
      database.prisma.topic.create({
        data: { id: topicId, name: "Platform", slug: "platform" },
      }),

    ]);

    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      LOGTO_ISSUER: issuer,
      LOGTO_AUDIENCE: audience,
      LOGTO_JWKS_URL: `http://127.0.0.1:${String(jwksAddress.port)}/jwks`,
      IDENTITY_EMAIL_FINGERPRINT_KEY: "mcp-integration-email-fingerprint-key",
    });
    application = await createMcpApplication(config, { logger: false });
    mcpServer = createMcpHttpServer({
      accounts: application.get<Accounts>(ACCOUNTS),
      authoring: application.get<MaterialAuthoring>(MATERIAL_AUTHORING),
      videos: application.get<Videos>(VIDEOS),
      communications: application.get(Communications),
      config: {
        host: "127.0.0.1",
        port: 0,
        serverUrl: "http://127.0.0.1:0/mcp",
      },
      identityIssuer: issuer,
      readiness: application.get(OperationalReadiness),
      tokenVerifier: application.get<LogtoAccessTokenVerifier>(
        LOGTO_ACCESS_TOKEN_VERIFIER,
      ),
    });
    const endpoint = await mcpServer.listen();
    client = new Client({ name: "platform-integration", version: "1.0.0" });
    const token = await signOwnerToken();
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        authProvider: { token: () => Promise.resolve(token) },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    await mcpServer.close();
    await application.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  });

  test("runs one delegated create, Save, Preview, publish and unpublish path", async () => {
    const initialMetadata = metadata("MCP lifecycle", "free");
    const created = await callTool("material_create_draft", {
      idempotencyKey: "mcp-create-lifecycle",
      metadata: initialMetadata,
      body: representativeDocument("Initial MCP body."),
    });
    expect(created).toMatchObject({
      structuredContent: {
        ok: true,
        value: { contentVersion: 1, publicationState: "draft" },
      },
    });
    const materialId = successfulMaterialId(created);

    const retriedCreate = await callTool("material_create_draft", {
      idempotencyKey: "mcp-create-lifecycle",
      metadata: initialMetadata,
      body: representativeDocument("Initial MCP body."),
    });
    expect(retriedCreate.structuredContent).toEqual(created.structuredContent);
    await expect(
      database.prisma.material.count({ where: { id: materialId } }),
    ).resolves.toBe(1);

    const loaded = await callTool("material_load", { materialId });
    expect(loaded).toMatchObject({
      structuredContent: {
        ok: true,
        value: {
          materialId,
          contentVersion: 1,
          metadata: { title: "MCP lifecycle" },
        },
      },
    });

    const saved = await callTool("material_save", {
      primaryVideoId: null,
      idempotencyKey: "mcp-save-draft",
      materialId,
      expectedContentVersion: 1,
      publicationState: "draft",
      metadata: metadata("MCP lifecycle current", "membership"),
      body: representativeDocument("Current MCP body."),
    });
    expect(saved).toMatchObject({
      structuredContent: {
        ok: true,
        value: { contentVersion: 2, publicationState: "draft" },
      },
    });

    const preview = await callTool("material_preview", { materialId });
    expect(preview).toMatchObject({
      structuredContent: {
        ok: true,
        value: {
          contentVersion: 2,
          cacheScope: "private-no-store",
          metadata: { access: "membership" },
          body: {
            blocks: [
              { kind: "heading" },
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Current MCP body." }],
              },
            ],
          },
        },
      },
    });

    const stale = await callTool("material_save", {
      primaryVideoId: null,
      idempotencyKey: "mcp-save-stale",
      materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: metadata("Rejected stale title", "free"),
      body: representativeDocument("Rejected stale body."),
    });
    expect(stale).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: {
          code: "stale_content_version",
          currentContentVersion: 2,
        },
      },
    });
    expect(await callTool("material_load", { materialId })).toMatchObject({
      structuredContent: {
        ok: true,
        value: {
          contentVersion: 2,
          metadata: { title: "MCP lifecycle current", access: "membership" },
        },
      },
    });

    const published = await callTool("material_save", {
      primaryVideoId: null,
      idempotencyKey: "mcp-publish",
      materialId,
      expectedContentVersion: 2,
      publicationState: "published",
      metadata: metadata("MCP lifecycle current", "membership"),
      body: representativeDocument("Current MCP body."),
    });
    expect(published).toMatchObject({
      structuredContent: {
        ok: true,
        value: { contentVersion: 3, publicationState: "published" },
      },
    });

    await database.prisma.accountPermission.delete({
      where: {
        accountId_permission: {
          accountId: ownerAccountId,
          permission: "materials:manage",
        },
      },
    });
    expect(await callTool("material_load", { materialId })).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
    for (const [name, args] of [
      ["video_attach_existing", { materialId, access: "membership", providerVideoId: "not-allowed" }],
      ["video_init_upload", { materialId, access: "membership", filename: "recording.mp4", title: "Recording", byteSize: 1024, idempotencyKey: "denied-upload" }],
      ["video_reconcile", { videoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
    ] as const) {
      expect(await callTool(name, args)).toMatchObject({ isError: true, structuredContent: { error: { code: "forbidden" } } });
    }
    await database.prisma.accountPermission.create({
      data: { accountId: ownerAccountId, permission: "materials:manage" },
    });

    const unpublished = await callTool("material_save", {
      primaryVideoId: null,
      idempotencyKey: "mcp-unpublish",
      materialId,
      expectedContentVersion: 3,
      publicationState: "unpublished",
      metadata: metadata("MCP lifecycle current", "free"),
      body: representativeDocument("Current MCP body."),
    });
    expect(unpublished).toMatchObject({
      structuredContent: {
        ok: true,
        value: { contentVersion: 4, publicationState: "unpublished" },
      },
    });
  });

  test("manages collections and the complete Playlist composition through application rules", async () => {
    const createdTopic = await callTool("content_collection_create", {
      kind: "topic",
      name: "MCP Architecture",
      slug: "mcp-architecture",
      summary: "Architecture managed through MCP.",
    });
    expect(createdTopic).toMatchObject({
      structuredContent: {
        ok: true,
        value: { kind: "topic", slug: "mcp-architecture", version: 1 },
      },
    });

    const createdPlaylist = await callTool("content_collection_create", {
      kind: "series",
      name: "MCP Platform path",
      slug: "mcp-platform-path",
      summary: "An ordered MCP-managed path.",
    });
    const playlist = successfulValue(createdPlaylist);
    if (
      typeof playlist.id !== "string" ||
      typeof playlist.version !== "number"
    ) {
      throw new TypeError("MCP result has no Playlist identity");
    }

    const material = await callTool("material_create_draft", {
      idempotencyKey: "mcp-playlist-material",
      metadata: metadata("MCP Playlist Material", "free"),
      body: representativeDocument("Playlist composition body."),
    });
    const materialId = successfulMaterialId(material);
    const initialComposition = await callTool("playlist_load_composition", {
      seriesId: playlist.id,
    });
    const initial = successfulValue(initialComposition);
    expect(initial.items).toEqual([]);
    if (typeof initial.orderVersion !== "string") {
      throw new TypeError("MCP result has no Playlist order version");
    }

    expect(
      await callTool("playlist_save_composition", {
        expectedOrderVersion: initial.orderVersion,
        orderedMaterialIds: [materialId],
        stepGroups: { [materialId]: "  MCP instruction  " },
        seriesId: playlist.id,
      }),
    ).toMatchObject({ structuredContent: { ok: true } });
    expect(
      await callTool("playlist_load_composition", { seriesId: playlist.id }),
    ).toMatchObject({
      structuredContent: {
        ok: true,
        value: { items: [{ materialId, ordinal: 1, stepGroup: "MCP instruction" }] },
      },
    });

    const updated = await callTool("content_collection_update", {
      collectionId: playlist.id,
      expectedVersion: playlist.version,
      kind: "series",
      name: "MCP Platform journey",
      summary: "A refined ordered path.",
    });
    expect(updated).toMatchObject({
      structuredContent: {
        ok: true,
        value: { name: "MCP Platform journey", slug: "mcp-platform-path", version: 2 },
      },
    });
    expect(
      await callTool("content_collection_update", {
        collectionId: playlist.id,
        expectedVersion: playlist.version,
        kind: "series",
        name: "Stale",
        summary: "",
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "stale_content_collection_version", currentVersion: 2 },
      },
    });

    expect(
      await callTool("content_collection_set_archive", {
        archived: true,
        collectionId: playlist.id,
        expectedVersion: 2,
        kind: "series",
      }),
    ).toMatchObject({
      structuredContent: {
        ok: true,
        value: { archived: true, version: 3 },
      },
    });
    expect(await callTool("content_collection_list", { kind: "series" })).toMatchObject({
      structuredContent: {
        ok: true,
        value: [expect.objectContaining({ archived: true, id: playlist.id })],
      },
    });
  });

  test("keeps validation and idempotency failures structured and effect-free", async () => {
    const countBefore = await database.prisma.material.count();
    const invalid = await callTool("material_create_draft", {
      idempotencyKey: "mcp-invalid-document",
      metadata: metadata("Invalid MCP document", "free"),
      body: { schemaVersion: 1, doc: { type: "unsupported" } },
    });
    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "invalid_content" },
      },
    });
    await expect(database.prisma.material.count()).resolves.toBe(countBefore);

    const reused = await callTool("material_create_draft", {
      idempotencyKey: "mcp-create-lifecycle",
      metadata: metadata("Different retry", "free"),
      body: representativeDocument("Different retry."),
    });
    expect(reused).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "idempotency_key_reused" },
      },
    });
    await expect(database.prisma.material.count()).resolves.toBe(countBefore);
  });

  test("attaches an existing Video, retries without duplication, preserves it on Save, and detaches without deleting the source", async () => {
    const meta = metadata("MCP existing video", "membership");
    const body = representativeDocument("Existing video through MCP.");
    const created = await callTool("material_create_draft", { idempotencyKey: "video-create", metadata: meta, body });
    const materialId = successfulMaterialId(created);
    const attachment = { materialId, access: "membership", providerVideoId: "test-mcp-existing-444" };
    const first = await callTool("video_attach_existing", attachment);
    const videoId = z.uuid().parse(successfulValue(first).videoId);
    expect(successfulValue(await callTool("video_attach_existing", attachment)).videoId).toBe(videoId);
    expect(successfulValue(await callTool("video_reconcile", { videoId })).state).toBe("ready");
    await expect(database.prisma.video.count({ where: { materialId } })).resolves.toBe(1);
    const save = { materialId, metadata: meta, body, publicationState: "draft", primaryVideoId: videoId };
    expect(successfulValue(await callTool("material_save", { ...save, expectedContentVersion: 1, idempotencyKey: "video-select" })).contentVersion).toBe(2);
    expect(successfulValue(await callTool("material_load", { materialId })).primaryVideoId).toBe(videoId);
    expect(successfulValue(await callTool("material_save", { ...save, expectedContentVersion: 2, idempotencyKey: "video-keep" })).contentVersion).toBe(3);
    expect(successfulValue(await callTool("material_load", { materialId })).primaryVideoId).toBe(videoId);
    const stale = await callTool("material_save", { ...save, primaryVideoId: null, expectedContentVersion: 2, idempotencyKey: "video-stale" });
    expect(stale).toMatchObject({ isError: true, structuredContent: { error: { code: "stale_content_version" } } });
    expect(successfulValue(await callTool("material_load", { materialId })).primaryVideoId).toBe(videoId);
    expect(successfulValue(await callTool("material_save", { ...save, primaryVideoId: null, expectedContentVersion: 3, idempotencyKey: "video-detach" })).contentVersion).toBe(4);
    const retained = await database.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(retained.state).toBe("ready");
    expect(retained.origin).toBe("external_attachment");
    expect(successfulValue(await callTool("material_load", { materialId })).primaryVideoId).toBeNull();
    const other = successfulMaterialId(await callTool("material_create_draft", { idempotencyKey: "video-other", metadata: meta, body }));
    expect(await callTool("video_attach_existing", { ...attachment, materialId: other })).toMatchObject({ isError: true, structuredContent: { error: { code: "provider_mismatch" } } });
  });

  test("initializes resumable upload once and rejects actor injection", async () => {
    const meta = metadata("MCP upload", "membership");
    const materialId = successfulMaterialId(await callTool("material_create_draft", { idempotencyKey: "upload-create", metadata: meta, body: representativeDocument("Upload.") }));
    const args = { materialId, access: "membership", filename: "recording.mp4", title: "Recording", byteSize: 1024, idempotencyKey: "mcp-upload-once" };
    expect(await callTool("video_init_upload", { ...args, actor: ownerAccountId })).toMatchObject({ isError: true });
    await expect(database.prisma.video.count({ where: { materialId } })).resolves.toBe(0);
    const first = successfulValue(await callTool("video_init_upload", args));
    const second = successfulValue(await callTool("video_init_upload", args));
    expect(second).toEqual(first);
    await expect(database.prisma.video.count({ where: { materialId } })).resolves.toBe(1);
    expect(first.uploadEndpoint).toMatch(/^https:\/\/uploads\.invalid\//u);
  });

  function callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<CallToolResult> {
    return client.callTool({ name, arguments: arguments_ });
  }

  function signOwnerToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({ roles: ["owner"], scope: "materials:manage" })
      .setProtectedHeader({ alg: "ES384", kid: "mcp-integration-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(ownerSubject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});

function metadata(
  title: string,
  access: "free" | "membership",
) {
  return {
    title,
    summary: "Material managed through the delegated MCP adapter.",
    access,
    topicId,
    formatId,
    tagIds: [],
    seriesIds: [],
  };
}

function successfulMaterialId(result: CallToolResult): string {
  const structured = result.structuredContent;
  if (
    structured === undefined ||
    typeof structured !== "object" ||
    structured === null ||
    !("ok" in structured) ||
    structured.ok !== true ||
    !("value" in structured) ||
    typeof structured.value !== "object" ||
    structured.value === null ||
    !("materialId" in structured.value) ||
    typeof structured.value.materialId !== "string"
  ) {
    throw new TypeError("MCP result has no successful Material identity");
  }
  return structured.value.materialId;
}

function successfulValue(result: CallToolResult): Record<string, unknown> {
  const structured = result.structuredContent;
  if (
    structured === undefined ||
    typeof structured !== "object" ||
    structured === null ||
    !("ok" in structured) ||
    structured.ok !== true ||
    !("value" in structured) ||
    typeof structured.value !== "object" ||
    structured.value === null ||
    Array.isArray(structured.value)
  ) {
    throw new TypeError("MCP result has no successful object value");
  }
  return z.record(z.string(), z.unknown()).parse(structured.value);
}
