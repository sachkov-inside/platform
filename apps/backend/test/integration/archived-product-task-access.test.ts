import { refusingMcpToolDependencies } from "../fixtures/inside-mcp-dependencies.js";
import { PaymentDiagnostics } from "../../src/modules/billing/index.js";
import { SalesFunnel } from "../../src/modules/sales-funnel/index.js";
import { z } from "zod";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createMcpHttpServer } from "../../src/entrypoints/mcp/mcp-http-server.js";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../../src/modules/accounts/index.js";
import {
  CONTENT_ACCESS,
  type ContentAccess,
} from "../../src/modules/content-access/index.js";
import {
  PUBLISHED_MATERIAL_READER,
  MATERIAL_AUTHORING,
  type PublishedMaterialReader,
  type MaterialAuthoring,
} from "../../src/modules/materials/index.js";
import {
  LEARNING_TASKS,
  type LearningTasks,
} from "../../src/modules/product-tasks/index.js";
import { VIDEOS, type Videos } from "../../src/modules/videos/index.js";
import { BillingOperations } from "../../src/modules/billing/index.js";
import { Communications } from "../../src/modules/communications/index.js";
import { WebTelemetry } from "../../src/modules/web-telemetry/index.js";
import { createHash, randomUUID } from "node:crypto";
import { expect, onTestFinished, test } from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { declaredServer } from "../support/declared-api.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { createScopedProductsWorld } from "./setup/scoped-products.js";

registerFixedClock();

test("an archived Product keeps Task pages, embedded tasks and files for holders while hiding its programme from others", async () => {
  const database = await createMigratedTestDatabase();
  onTestFinished(() => database.dispose());
  const identity = await startTestIdentityIssuer({
    issuer: "https://archive-tasks.test/oidc",
    audience: "https://archive-tasks.test/api",
  });
  onTestFinished(() => identity.close());
  const app = await createApiApplication(
    parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      LOGTO_ISSUER: identity.issuer,
      LOGTO_AUDIENCE: identity.audience,
      LOGTO_JWKS_URL: identity.jwksUrl,
      IDENTITY_EMAIL_FINGERPRINT_KEY: "archive-task-synthetic-fingerprint",
    }),
    { logger: false },
  );
  onTestFinished(() => app.close());
  await app.init();
  const server = declaredServer(app.getHttpAdapter().getInstance());
  await server.ready();
  const world = await createScopedProductsWorld(database);
  const subject = `archive-holder-${randomUUID()}`;
  const bearer = await identity.sign(subject, {
    inside_verified_email: `${subject}@example.test`,
  });
  const headers = { authorization: `Bearer ${bearer}` };
  expect(
    (await server.inject({ method: "POST", url: "/accounts", headers }))
      .statusCode,
  ).toBe(201);
  const holder = await database.prisma.account.findFirstOrThrow({
    where: { logtoSubject: subject },
  });
  const grantA = await world.grantProduct(holder.id, world.productA.productId);
  const grantFree = await world.grantProduct(
    holder.id,
    world.freeProduct.productId,
  );
  const freeProduct = await database.prisma.product.findUniqueOrThrow({
    where: { id: world.freeProduct.productId },
  });
  const targetTask = await database.prisma.productTask.findUniqueOrThrow({
    where: { code: world.productA.taskCode },
  });
  for (const item of [world.productA, world.freeProduct]) {
    await database.prisma.productTask.update({
      where: { code: item.taskCode },
      data: {
        page: {
          source: {
            title: "Preserved Task page",
            summary: "Archive proof",
            markdown: "[Destination](/task-destination)",
            links: { "/task-destination": targetTask.sourceId },
            images: {},
          },
          body: {
            schemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { nodeId: randomUUID() },
                  content: [
                    {
                      type: "text",
                      text: "Destination",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "/task-destination" },
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "assetFile",
                  attrs: {
                    nodeId: randomUUID(),
                    assetId: item.assetId,
                    label: "Task file",
                  },
                },
              ],
            },
          },
          resolvedLinks: { "/task-destination": targetTask.sourceId },
          resolvedImages: {
            "task-file": {
              materialId: item.materialId,
              assetId: item.assetId,
            },
          },
        },
      },
    });
  }
  const mcp = createMcpHttpServer({
    ...refusingMcpToolDependencies(),
    accounts: app.get<Accounts>(ACCOUNTS),
    learning: {
      reader: app.get<PublishedMaterialReader>(PUBLISHED_MATERIAL_READER),
      contentAccess: app.get<ContentAccess>(CONTENT_ACCESS),
      videos: app.get<Videos>(VIDEOS),
      tasks: app.get<LearningTasks>(LEARNING_TASKS),
    },
    authoring: app.get<MaterialAuthoring>(MATERIAL_AUTHORING),
    videos: app.get<Videos>(VIDEOS),
    communications: app.get(Communications),
    billing: app.get(BillingOperations),
    diagnostics: app.get(PaymentDiagnostics),
    funnel: app.get(SalesFunnel),
    telemetry: app.get(WebTelemetry),
    config: {
      host: "127.0.0.1",
      port: 0,
      serverUrl: "http://127.0.0.1:0/mcp",
    },
    identityIssuer: identity.issuer,
    readiness: app.get(OperationalReadiness),
    tokenVerifier: app.get<LogtoAccessTokenVerifier>(
      LOGTO_ACCESS_TOKEN_VERIFIER,
    ),
  });
  onTestFinished(() => mcp.close());
  const listening = await mcp.listen();
  async function connect(name: string) {
    const token = await identity.sign(
      name,
      { scope: "openid offline_access learning:read" },
      "http://127.0.0.1:0/mcp/learning",
    );
    const client = new Client({ name: "archive-task-proof", version: "1" });
    onTestFinished(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`${listening.pathname}/learning`, listening),
        { authProvider: { token: () => Promise.resolve(token) } },
      ),
    );
    return client;
  }
  const holderMcp = await connect(subject);
  const strangerSubject = `archive-stranger-${randomUUID()}`;
  const strangerToken = await identity.sign(strangerSubject, {
    inside_verified_email: `${strangerSubject}@example.test`,
  });
  const strangerHeaders = { authorization: `Bearer ${strangerToken}` };
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/accounts",
        headers: strangerHeaders,
      })
    ).statusCode,
  ).toBe(201);
  const strangerMcp = await connect(strangerSubject);
  const text = (result: CallToolResult) =>
    z
      .object({
        content: z.array(
          z.object({ type: z.literal("text"), text: z.string() }),
        ),
      })
      .parse(result)
      .content.map((item) => item.text)
      .join("");
  const readMcp = async (client: Client, code: string) => {
    const parse = (result: CallToolResult) =>
      z
        .object({
          ok: z.literal(true),
          value: z.object({
            contextVersion: z.string(),
            contentSha256: z.string(),
            partCount: z.number().int().positive(),
            partSha256: z.string(),
            data: z.string(),
            nextPart: z.number().int().nullable(),
            endOfContext: z.boolean(),
          }),
        })
        .parse(JSON.parse(text(result))).value;
    const first = parse(
      await client.callTool({
        name: "learning_task_read",
        arguments: { code, part: 0 },
      }),
    );
    const hash = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    expect(hash(first.data)).toBe(first.partSha256);
    let combined = first.data;
    let next = first.nextPart;
    for (let index = 1; index < first.partCount; index += 1) {
      expect(next).toBe(index);
      const part = parse(
        await client.callTool({
          name: "learning_task_read",
          arguments: {
            code,
            part: index,
            expectedContextVersion: first.contextVersion,
            expectedContentSha256: first.contentSha256,
          },
        }),
      );
      expect(part.contextVersion).toBe(first.contextVersion);
      expect(part.contentSha256).toBe(first.contentSha256);
      expect(hash(part.data)).toBe(part.partSha256);
      expect(part.endOfContext).toBe(index === first.partCount - 1);
      combined += part.data;
      next = part.nextPart;
    }
    expect(next).toBeNull();
    expect(hash(combined)).toBe(first.contentSha256);
    expect(combined).toContain(`END_CONTEXT:${first.contextVersion}`);
    return combined;
  };
  const historyUrl = `/accounts/current/product-tasks/${world.productA.taskCode}/submissions`;
  const submitted = await server.inject({
    method: "POST",
    url: historyUrl,
    headers,
    payload: {
      taskVersion: 1,
      submissionKey: randomUUID(),
      note: "Preserved before archive",
      reportText: "Own immutable report",
    },
  });
  expect(submitted.statusCode).toBe(200);
  const originalHistory = (
    await server.inject({ method: "GET", url: historyUrl, headers })
  ).json<{ submissions: unknown[] }>();
  const product = await database.prisma.product.findUniqueOrThrow({
    where: { id: world.productA.productId },
  });
  const page = `/library/products/${product.slug}/tasks/${world.productA.taskCode}`;
  expect(
    (await server.inject({ method: "GET", url: page, headers })).statusCode,
  ).toBe(200);
  await database.prisma.product.update({
    where: { id: world.productA.productId },
    data: { archivedAt: new Date("2026-10-01T00:00:00Z") },
  });
  const archived = await server.inject({ method: "GET", url: page, headers });
  expect(archived.statusCode).toBe(200);
  expect(archived.body).toContain(world.productA.taskSecret);
  expect(
    (
      await server.inject({
        method: "POST",
        url: historyUrl,
        headers,
        payload: {
          taskVersion: 1,
          submissionKey: randomUUID(),
          note: "Saved while archived",
          reportText: "Second immutable report",
        },
      })
    ).statusCode,
  ).toBe(200);
  const archiveHistory = (
    await server.inject({ method: "GET", url: historyUrl, headers })
  ).json<{ submissions: unknown[] }>();
  expect(archiveHistory.submissions).toHaveLength(2);
  expect(archiveHistory.submissions).toEqual(
    expect.arrayContaining(originalHistory.submissions),
  );

  expect(
    (
      await server.inject({
        method: "GET",
        url: `/library/materials/${world.productA.materialId}/task`,
        headers,
      })
    ).body,
  ).toContain(world.productA.taskSecret);
  expect(
    (
      await server.inject({
        method: "GET",
        url: `/materials/${world.productA.slug}`,
        headers,
      })
    ).body,
  ).toContain(world.productA.bodySecret);
  const file = await server.inject({
    method: "GET",
    url: `${page}/assets/${world.productA.assetId}`,
    headers,
  });
  expect(file.statusCode).toBe(302);
  expect(file.headers.location).toContain(world.productA.protectedObjectKey);
  // Through Caddy (#1766) the same decision hands the signed address to the edge; a Task asset
  // address carries no version, so its bytes are never kept.
  const edgeFile = await server.inject({
    method: "GET",
    url: `${page}/assets/${world.productA.assetId}`,
    headers: { ...headers, "x-inside-storage-delivery": "edge" },
  });
  expect(edgeFile.statusCode).toBe(204);
  expect(edgeFile.headers.location).toBeUndefined();
  expect(String(edgeFile.headers["x-inside-storage-location"])).toContain(
    world.productA.protectedObjectKey,
  );
  expect(edgeFile.headers["x-inside-storage-cache-control"]).toBe(
    "private, no-store",
  );
  expect(await readMcp(holderMcp, world.productA.taskCode)).toContain(
    world.productA.taskSecret,
  );
  const listed = await holderMcp.callTool({
    name: "learning_tasks_list",
    arguments: { productSlug: product.slug },
  });
  expect(listed.isError).toBe(false);
  expect(text(listed)).toContain(world.productA.taskCode);
  const linkUrl = `/products/${product.slug}/tasks/${world.productA.taskCode}`;
  const sourcePage = `/library/products/${freeProduct.slug}/tasks/${world.freeProduct.taskCode}`;
  expect(
    (await server.inject({ method: "GET", url: sourcePage, headers })).body,
  ).toContain(linkUrl);
  expect(
    (await server.inject({ method: "GET", url: sourcePage })).body,
  ).not.toContain(linkUrl);
  for (const deniedHeaders of [
    {},
    strangerHeaders,
    { "x-inside-storage-delivery": "edge" },
    { ...strangerHeaders, "x-inside-storage-delivery": "edge" },
  ]) {
    for (const url of [
      page,
      `/library/materials/${world.productA.materialId}/task`,
      `${page}/assets/${world.productA.assetId}`,
      `/library/products/${product.slug}`,
    ]) {
      const denied = await server.inject({
        method: "GET",
        url,
        headers: deniedHeaders,
      });
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain(world.productA.taskSecret);
      expect(denied.headers.location).toBeUndefined();
      expect(denied.headers["x-inside-storage-location"]).toBeUndefined();
    }
  }
  expect(
    (
      await strangerMcp.callTool({
        name: "learning_task_read",
        arguments: { code: world.productA.taskCode },
      })
    ).isError,
  ).toBe(true);
  expect(
    text(
      await strangerMcp.callTool({
        name: "learning_tasks_list",
        arguments: {},
      }),
    ),
  ).not.toContain(world.productA.taskCode);
  await database.prisma.product.update({
    where: { id: world.freeProduct.productId },
    data: { archivedAt: new Date("2026-10-01T00:00:00Z") },
  });
  expect(
    (await server.inject({ method: "GET", url: sourcePage, headers }))
      .statusCode,
  ).toBe(200);
  for (const deniedHeaders of [{}, strangerHeaders])
    expect(
      (
        await server.inject({
          method: "GET",
          url: sourcePage,
          headers: deniedHeaders,
        })
      ).statusCode,
    ).toBe(404);
  expect(
    (
      await strangerMcp.callTool({
        name: "learning_task_read",
        arguments: { code: world.freeProduct.taskCode },
      })
    ).isError,
  ).toBe(true);
  expect(
    text(
      await strangerMcp.callTool({
        name: "learning_tasks_list",
        arguments: {},
      }),
    ),
  ).not.toContain(world.freeProduct.taskCode);
  expect(await readMcp(holderMcp, world.freeProduct.taskCode)).toContain(
    world.freeProduct.taskSecret,
  );
  await world.revokeGrant(grantA);
  await world.revokeGrant(grantFree);
  for (const url of [
    page,
    `${page}/assets/${world.productA.assetId}`,
    sourcePage,
  ])
    expect(
      (await server.inject({ method: "GET", url, headers })).statusCode,
    ).toBe(404);
  expect(
    (
      await holderMcp.callTool({
        name: "learning_task_read",
        arguments: { code: world.productA.taskCode },
      })
    ).isError,
  ).toBe(true);
  expect(
    (await server.inject({ method: "GET", url: historyUrl, headers })).json(),
  ).toEqual(archiveHistory);
  expect(
    (
      await server.inject({
        method: "POST",
        url: historyUrl,
        headers,
        payload: {
          taskVersion: 1,
          submissionKey: randomUUID(),
          note: "Must stay denied",
        },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    await database.prisma.productTaskSubmission.count({
      where: { accountId: holder.id, taskId: targetTask.id },
    }),
  ).toBe(2);
  const foreignHistory = await server.inject({
    method: "GET",
    url: historyUrl,
    headers: strangerHeaders,
  });
  expect(foreignHistory.body).not.toContain("Own immutable report");
  expect(
    (
      await server.inject({
        method: "GET",
        url: `/materials/${world.publicMaterial.slug}`,
      })
    ).body,
  ).toContain(world.publicMaterial.bodyText);
});
