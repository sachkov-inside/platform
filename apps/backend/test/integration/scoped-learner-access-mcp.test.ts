import { registerFixedClock } from "../support/fixed-clock.js";

import {
  LEARNING_TASKS,
  type LearningTasks,
} from "../../src/modules/product-tasks/index.js";
import { randomUUID } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createMcpApplication } from "../../src/entrypoints/create-mcp-application.js";
import {
  createMcpHttpServer,
  type McpHttpServer,
} from "../../src/entrypoints/mcp/mcp-http-server.js";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../../src/modules/accounts/index.js";
import { verifiedAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import { BillingOperations } from "../../src/modules/billing/index.js";
import { Communications } from "../../src/modules/communications/index.js";
import {
  CONTENT_ACCESS,
  type ContentAccess,
} from "../../src/modules/content-access/index.js";
import {
  MATERIAL_AUTHORING,
  PUBLISHED_MATERIAL_READER,
  type MaterialAuthoring,
  type PublishedMaterialReader,
} from "../../src/modules/materials/index.js";
import { VIDEOS, type Videos } from "../../src/modules/videos/index.js";
import {
  createScopedProductsWorld,
  type ScopedProduct,
  type ScopedProductsWorld,
} from "./setup/scoped-products.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const toolText = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});
const practicePart = z.object({
  ok: z.literal(true),
  value: z.object({
    contextVersion: z.string(),
    contentSha256: z.string(),
    partCount: z.number().int().positive(),
    data: z.string(),
    nextPart: z.number().int().nullable(),
  }),
});

/** Закреплённый контекст задания, который клиент мог сохранить до отзыва права. */
interface PinnedPractice {
  readonly contextVersion: string;
  readonly contentSha256: string;
  readonly partCount: number;
  /** Все части, склеенные по порядку. */
  readonly context: string;
}

/**
 * Scoped ученик через настоящий learner MCP transport (#903, пробел 5 из #902): процесс MCP поднят
 * целиком, клиент MCP ходит по Streamable HTTP на `/mcp/learning` с подписанным токеном Account,
 * право — настоящий AccessGrant одного Product. Отказ инструмента — `isError` с кодом в ответе
 * JSON-RPC; транспорт не обязан отвечать HTTP 403. Каждая клетка доказана наличием или отсутствием
 * секрета Product. Строки матрицы проверок доступа: `test/access-scenarios/access-check-matrix.ts`.
 */
describe("scoped learner access over the learner MCP transport", () => {
  let application: INestApplicationContext;
  let mcpServer: McpHttpServer;
  let endpoint: URL;
  let database: TestDatabase;
  let identity: TestIdentityIssuer;
  let world: ScopedProductsWorld;
  // deterministic-test-allow shared-mutation: Cleanup registry closes every owned MCP client afterAll; it is not scenario seed data.
  const clients: Client[] = [];

  beforeAll(async () => {
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.scoped-mcp.test/oidc",
      audience: "https://api.scoped-mcp.test",
    });
    database = await createMigratedTestDatabase();
    world = await createScopedProductsWorld(database);
    application = await createMcpApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: identity.issuer,
        LOGTO_AUDIENCE: identity.audience,
        LOGTO_JWKS_URL: identity.jwksUrl,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "scoped-mcp-email-fingerprint-key",
      }),
      { logger: false },
    );
    mcpServer = createMcpHttpServer({
      accounts: application.get<Accounts>(ACCOUNTS),
      learning: {
        reader: application.get<PublishedMaterialReader>(
          PUBLISHED_MATERIAL_READER,
        ),
        contentAccess: application.get<ContentAccess>(CONTENT_ACCESS),
        videos: application.get<Videos>(VIDEOS),
        tasks: application.get<LearningTasks>(LEARNING_TASKS),
      },
      authoring: application.get<MaterialAuthoring>(MATERIAL_AUTHORING),
      videos: application.get<Videos>(VIDEOS),
      communications: application.get(Communications),
      billing: application.get(BillingOperations),
      config: {
        host: "127.0.0.1",
        port: 0,
        serverUrl: "http://127.0.0.1:0/mcp",
      },
      identityIssuer: identity.issuer,
      readiness: application.get(OperationalReadiness),
      tokenVerifier: application.get<LogtoAccessTokenVerifier>(
        LOGTO_ACCESS_TOKEN_VERIFIER,
      ),
    });
    const listening = await mcpServer.listen();
    endpoint = new URL(`${listening.pathname}/learning`, listening);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await mcpServer.close();
    await application.close();
    await database.dispose();
    await identity.close();
  });

  test("material and practice calls without an Account token get 401 and no protected bytes", async () => {
    for (const [name, arguments_] of [
      ["learning_material_read", { slug: world.productA.slug }],
      ["learning_practice_read", { practiceId: world.productA.practiceId }],
    ] as const) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: arguments_ },
        }),
      });
      const body = await response.text();
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
      expect(body).not.toContain(world.productA.bodySecret);
      expect(body).not.toContain(world.productA.practiceSecret);
    }
  });

  test("Account without entitlement reads the public Material and no protected Material or practice part", async () => {
    const { learner } = await connectedLearner();
    expect(await readPublic(learner)).toBe("open");
    for (const product of [world.productA, world.productB])
      await expectClosed(learner, product);
  });

  test("Account without entitlement reads every pinned part of a free practice while paid Products stay closed", async () => {
    const { learner } = await connectedLearner();
    await expectOpen(learner, world.freeProduct);
    for (const product of [world.productA, world.productB])
      await expectClosed(learner, product);
  });

  test("learner of Product A reads its Material and every pinned practice part while Product B stays closed", async () => {
    const { learner, accountId } = await connectedLearner();
    await world.grantProduct(accountId, world.productA.productId);
    await expectOpen(learner, world.productA);
    await expectClosed(learner, world.productB);
  });

  test("learner of Product B reads its Material and every pinned practice part while Product A stays closed", async () => {
    const { learner, accountId } = await connectedLearner();
    await world.grantProduct(accountId, world.productB.productId);
    await expectOpen(learner, world.productB);
    await expectClosed(learner, world.productA);
  });

  test("expired Product A grant reads the public Material and no protected Material or practice part", async () => {
    const { learner, accountId } = await connectedLearner();
    await world.grantExpiredProduct(accountId, world.productA.productId);
    expect(await readPublic(learner)).toBe("open");
    await expectClosed(learner, world.productA);
  });

  test("revoking Product A closes the Material and every part pinned before revocation while Product B stays open", async () => {
    const { learner, accountId } = await connectedLearner();
    const grantA = await world.grantProduct(
      accountId,
      world.productA.productId,
    );
    await world.grantProduct(accountId, world.productB.productId);
    const pinned = await expectOpen(learner, world.productA);

    await world.revokeGrant(grantA);

    await expectClosed(learner, world.productA);
    // Клиент продолжает чтение по версии и хешу, закреплённым до отзыва: ни одна часть не выдаётся.
    for (let part = 0; part < pinned.partCount; part += 1) {
      const cached = await practice(learner, world.productA, {
        part,
        expectedContextVersion: pinned.contextVersion,
        expectedContentSha256: pinned.contentSha256,
      });
      expect(cached.isError).toBe(true);
      expect(text(cached)).toContain("practice_not_available");
      expect(text(cached)).not.toContain(world.productA.practiceSecret);
      expect(text(cached)).not.toContain(world.productA.bodySecret);
    }
    await expectOpen(learner, world.productB);
  });

  async function connectedLearner(): Promise<{
    readonly learner: Client;
    readonly accountId: string;
  }> {
    const subject = `scoped-mcp-${randomUUID()}`;
    const established = await application
      .get<Accounts>(ACCOUNTS)
      .establishAccount({
        identity: verifiedAccountSignIn({
          issuer: identity.issuer,
          subject,
          verifiedEmail: `${subject}@example.test`,
        }).identity,
      });
    if (!established.ok) throw new Error("Learner Account fixture failed");
    const token = await identity.sign(
      subject,
      { scope: "openid offline_access learning:read" },
      // Учебный MCP принимает только токен своего ресурса, адрес из конфигурации сервера.
      "http://127.0.0.1:0/mcp/learning",
    );
    const learner = new Client({ name: "scoped-learner", version: "1" });
    clients.push(learner);
    await learner.connect(
      new StreamableHTTPClientTransport(endpoint, {
        authProvider: { token: () => Promise.resolve(token) },
      }),
    );
    return { learner, accountId: established.account.accountId };
  }

  function text(result: CallToolResult): string {
    return toolText
      .parse(result)
      .content.map((item) => item.text)
      .join("");
  }

  function readMaterial(learner: Client, slug: string) {
    return learner.callTool({
      name: "learning_material_read",
      arguments: { slug },
    });
  }

  async function readPublic(learner: Client): Promise<"open"> {
    const read = await readMaterial(learner, world.publicMaterial.slug);
    expect(read.isError).toBe(false);
    expect(text(read)).toContain(world.publicMaterial.bodyText);
    return "open";
  }

  function practice(
    learner: Client,
    product: ScopedProduct,
    pin: {
      readonly part: number;
      readonly expectedContextVersion?: string;
      readonly expectedContentSha256?: string;
    },
  ) {
    return learner.callTool({
      name: "learning_practice_read",
      arguments: { practiceId: product.practiceId, ...pin },
    });
  }

  /** Материал и все части задания открыты: тело и контекст содержат секреты Product целиком. */
  async function expectOpen(
    learner: Client,
    product: ScopedProduct,
  ): Promise<PinnedPractice> {
    const read = await readMaterial(learner, product.slug);
    expect(read.isError).toBe(false);
    expect(text(read)).toContain(product.bodySecret);

    const first = practicePart.parse(
      JSON.parse(text(await practice(learner, product, { part: 0 }))),
    ).value;
    expect(first.partCount).toBeGreaterThan(1);
    let context = first.data;
    for (let part = 1; part < first.partCount; part += 1) {
      const next = practicePart.parse(
        JSON.parse(
          text(
            await practice(learner, product, {
              part,
              expectedContextVersion: first.contextVersion,
              expectedContentSha256: first.contentSha256,
            }),
          ),
        ),
      ).value;
      context += next.data;
    }
    expect(context).toContain(product.practiceSecret);
    expect(context).toContain(product.bodySecret);
    expect(context).toContain(`END_CONTEXT:${first.contextVersion}`);
    return {
      contextVersion: first.contextVersion,
      contentSha256: first.contentSha256,
      partCount: first.partCount,
      context,
    };
  }

  /** Отказ инструмента: `isError` с кодом и без единого секрета Product. */
  async function expectClosed(
    learner: Client,
    product: ScopedProduct,
  ): Promise<void> {
    const read = await readMaterial(learner, product.slug);
    expect(read.isError).toBe(true);
    expect(text(read)).toContain("material_not_available");
    expect(text(read)).not.toContain(product.bodySecret);
    const first = await practice(learner, product, { part: 0 });
    expect(first.isError).toBe(true);
    expect(text(first)).toContain("practice_not_available");
    expect(text(first)).not.toContain(product.practiceSecret);
    expect(text(first)).not.toContain(product.bodySecret);
  }
});
