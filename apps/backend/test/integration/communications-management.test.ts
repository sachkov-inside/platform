import { VIDEOS, type Videos } from "../../src/modules/videos/index.js";
import { z } from "zod";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import { randomBytes, randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  createMcpHttpServer,
  type McpHttpServer,
} from "../../src/entrypoints/mcp/mcp-http-server.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  assembleAccounts,
  bootstrapOwnerAccount,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../../src/modules/accounts/index.js";
import { verifiedAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import {
  MATERIAL_AUTHORING,
  type MaterialAuthoring,
} from "../../src/modules/materials/index.js";
import { Communications } from "../../src/modules/communications/index.js";
import {
  requestSchema,
  responseSchema,
} from "../../src/modules/communications/communications-schema.generated.js";
import {
  COMMUNICATIONS_VERSION,
  managementSchemas,
  type ProviderRequest,
} from "../../src/modules/communications/communications-contract.js";
import fixtures from "../../src/modules/communications/contracts/inside-communications-v1/fixtures.json" with { type: "json" };
import scenarios from "../../src/modules/communications/contracts/inside-communications-v1/scenarios.json" with { type: "json" };
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://communications.test/oidc";
const audience = "https://communications.test/api";
const secret = "synthetic-communications-secret";
const authorizationSecret = "synthetic-authorization-secret";
const botIdentity = "synthetic-bot";
const provider = Fastify();
const captured: ProviderRequest[] = [];
const version = { contractVersion: COMMUNICATIONS_VERSION };
const content = {
  type: "text",
  text: "Synthetic example",
  entities: [],
  buttons: [],
};
let nextResponse: { status: number; body: unknown };

function sample(operation: string) {
  for (const fixture of fixtures) {
    if (fixture.definition !== "request" || !fixture.valid) continue;
    const parsed = requestSchema.safeParse(fixture.value);
    if (parsed.success && parsed.data.operation === operation) {
      const { actor: _actor, ...input } = parsed.data;
      return input;
    }
  }
  throw new Error(`Missing provider fixture: ${operation}`);
}

function toolArguments(input: {
  contractVersion: string;
  operation: string;
  operationId: string;
  expectedRevision: number;
  payload: unknown;
}) {
  const { contractVersion: _version, operation: _operation, ...args } = input;
  return args;
}

describe("HTTP and delegated OAuth communications parity against a contract stub", () => {
  let app: NestFastifyApplication;
  let database: TestDatabase;
  let privateKey: CryptoKey;
  let mcp: McpHttpServer;
  let endpoint: URL;
  const accountIds = new Map<string, string>();
  const clients = new Map<string, Client>();

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "communications-key",
    };
    provider.get("/jwks", () => ({ keys: [jwk] }));
    provider.post(
      "/integrations/platform/v1/communications",
      async (request, reply) => {
        if (request.headers.authorization !== `Bearer ${secret}`)
          return reply.status(401).send({ ...version, status: "unauthorized" });
        const parsed = requestSchema.safeParse(request.body);
        if (!parsed.success || !("accountRef" in parsed.data.actor))
          return reply.status(400).send({ ...version, status: "malformed" });
        const command = parsed.data;
        captured.push(command);
        const authorization = await app.inject({
          method: "POST",
          url: "/integrations/telegram/v1/communications/authorize",
          headers: { authorization: `Bearer ${authorizationSecret}` },
          payload: {
            ...version,
            requestId: randomUUID(),
            permission: "communications:manage",
            subject: {
              kind: "account",
              accountRef: parsed.data.actor.accountRef,
            },
          },
        });
        if (
          authorization.statusCode !== 200 ||
          z.object({ status: z.string() }).parse(authorization.json<unknown>())
            .status !== "allowed"
        )
          return reply.status(403).send({ ...version, status: "forbidden" });
        return reply.status(nextResponse.status).send(nextResponse.body);
      },
    );
    const providerUrl = await provider.listen({ port: 0, host: "127.0.0.1" });
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "synthetic-communications-fingerprint",
    });
    for (const subject of [
      "owner",
      "other",
      "materials-only",
      "unlinked",
      "ordinary",
    ]) {
      const permission =
        subject === "materials-only"
          ? "materials:manage"
          : "communications:manage";
      if (subject === "ordinary") {
        const proof = verifiedAccountSignIn({
          issuer,
          subject,
          verifiedEmail: "ordinary@example.test",
        });
        const result = await accounts.establishAccount({
          identity: proof.identity,
        });
        if (!result.ok) throw new Error("Could not establish fixture Account");
        accountIds.set(subject, result.account.accountId);
      } else
        accountIds.set(
          subject,
          (
            await bootstrapOwnerAccount(
              database.prisma,
              { issuer, subject },
              permission,
            )
          ).accountId,
        );
      if (subject !== "unlinked") {
        const now = new Date();
        await database.prisma.telegramLinkTransaction.create({
          data: {
            linkRef: randomUUID(),
            accountId: required(accountIds.get(subject)),
            principalRef:
              subject === "owner"
                ? "synthetic-author"
                : subject === "other"
                  ? "synthetic-other"
                  : subject,
            providerIdentityRef: `identity-${subject}`,
            providerTransactionRef: randomUUID(),
            returnCorrelation: randomUUID(),
            tokenDigest: randomBytes(32).toString("base64url"),
            status: "linked",
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
          },
        });
      }
    }
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `${providerUrl}/jwks`,
        TELEGRAM_COMMUNICATIONS_ENDPOINT: `${providerUrl}/integrations/platform/v1/communications`,
        TELEGRAM_COMMUNICATIONS_SECRET: secret,
        TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN: "https://inside.example",
        TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: authorizationSecret,
        TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: botIdentity,
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    mcp = createMcpHttpServer({
      accounts: app.get<Accounts>(ACCOUNTS),
      authoring: app.get<MaterialAuthoring>(MATERIAL_AUTHORING),
      videos: app.get<Videos>(VIDEOS),
      communications: app.get(Communications),
      tokenVerifier: app.get<LogtoAccessTokenVerifier>(
        LOGTO_ACCESS_TOKEN_VERIFIER,
      ),
      identityIssuer: issuer,
      config: {
        host: "127.0.0.1",
        port: 0,
        serverUrl: "http://127.0.0.1:0/mcp",
      },
      readiness: app.get(OperationalReadiness),
    });
    endpoint = await mcp.listen();
    for (const subject of accountIds.keys()) {
      const client = new Client({
        name: `communications-${subject}`,
        version: "1.0.0",
      });
      await client.connect(
        new StreamableHTTPClientTransport(endpoint, {
          authProvider: { token: () => token(subject) },
        }),
      );
      clients.set(subject, client);
    }
  });
  beforeEach(() => {
    captured.length = 0;
    nextResponse = {
      status: 501,
      body: { ...version, status: "not_implemented" },
    };
  });
  afterAll(async () => {
    await Promise.all([...clients.values()].map((client) => client.close()));
    await mcp?.close();
    await app?.close();
    await provider.close();
    await database?.dispose();
  });

  function token(subject: string) {
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES384", kid: "communications-key" })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
  async function http(
    input: unknown,
    subject = "owner",
    path = "/communications",
  ) {
    return app.inject({
      method: "POST",
      url: path,
      headers: {
        authorization: `Bearer ${await token(subject)}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify(input),
    });
  }
  async function call(
    input: Parameters<typeof toolArguments>[0],
    subject = "owner",
  ) {
    return required(clients.get(subject)).callTool({
      name: `communications_${input.operation.replaceAll(".", "_")}`,
      arguments: toolArguments(input),
    });
  }

  test("every contracted management command is registered and preserves its envelope through HTTP and MCP", async () => {
    const { tools } = await required(clients.get("owner")).listTools();
    for (const schema of managementSchemas) {
      const operation = schema.shape.operation.value;
      const input = sample(operation);
      expect(
        tools.some(
          (tool) =>
            tool.name === `communications_${operation.replaceAll(".", "_")}`,
        ),
      ).toBe(true);
      expect((await http(input)).statusCode).toBe(501);
      expect(await call(input)).toMatchObject({
        isError: true,
        structuredContent: { ok: false, error: { code: "not_implemented" } },
      });
      if (["funnels.preview", "funnels.publish"].includes(operation)) {
        expect(captured.slice(-2)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operation: "funnels.read",
              payload: input.payload,
              actor: { accountRef: "synthetic-author" },
            }),
          ]),
        );
      } else
        expect(captured.slice(-2)).toEqual(
          Array.from({ length: 2 }, () => ({
            ...input,
            actor: { accountRef: "synthetic-author" },
          })),
        );
    }
    expect(
      tools.find((tool) => tool.name === "communications_funnels_preview")
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "communications_templates_testSend")
        ?.annotations?.readOnlyHint,
    ).toBe(false);
  });

  test("publish and launch succeed over both transports without a second UI approval", async () => {
    const funnelSave = sample("funnels.save");
    const broadcastSave = sample("broadcasts.save");
    for (const operation of ["funnels.publish", "broadcasts.launch"]) {
      const input = sample(operation);
      nextResponse = {
        status: 200,
        body:
          operation === "funnels.publish"
            ? {
                ...version,
                status: "ok",
                funnel: {
                  ...funnelSave.payload,
                  revision: 1,
                  publishedRevision: 1,
                  lifecycle: "published",
                },
              }
            : {
                ...version,
                status: "ok",
                broadcast: {
                  ...broadcastSave.payload,
                  revision: 1,
                  state: "running",
                  audienceSnapshotId: randomUUID(),
                  snapshotSize: 3,
                },
              },
      };
      responseSchema.parse(nextResponse.body);
      const first = await http(input);
      expect(first.statusCode).toBe(200);
      expect(await call(input)).toMatchObject({
        structuredContent: first.json<unknown>(),
      });
      expect(
        captured
          .filter((request) => request.operation === operation)
          .slice(-2)[0],
      ).toEqual(
        captured
          .filter((request) => request.operation === operation)
          .slice(-1)[0],
      );
    }
  });

  test("unavailable public targets block publication over HTTP and MCP before dispatch", async () => {
    const input = sample("funnels.publish");
    const draft = sample("funnels.save");
    nextResponse = {
      status: 200,
      body: {
        ...version,
        status: "ok",
        funnel: {
          ...draft.payload,
          revision: input.expectedRevision,
          publishedRevision: null,
          lifecycle: "draft",
          entryResponse: {
            stepId: randomUUID(),
            parts: [
              {
                partId: randomUUID(),
                content: {
                  ...content,
                  text: "https://inside.example/materials/missing-target",
                },
              },
            ],
          },
        },
      },
    };
    responseSchema.parse(nextResponse.body);
    expect((await http(input)).json()).toMatchObject({
      code: "invalid_targets",
    });
    expect(await call(input)).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "invalid_targets" } },
    });
    expect(captured.map((request) => request.operation)).toEqual([
      "funnels.read",
      "funnels.read",
    ]);
  });

  test("unauthenticated, ordinary, materials-only and unlinked Accounts cannot dispatch", async () => {
    const input = sample("broadcasts.launch");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/communications",
          payload: input,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    for (const subject of ["ordinary", "materials-only", "unlinked"]) {
      const code = subject === "unlinked" ? "link_required" : "forbidden";
      expect((await http(input, subject)).json()).toMatchObject({ code });
      expect(await call(input, subject)).toMatchObject({
        isError: true,
        structuredContent: { ok: false, error: { code } },
      });
    }
    expect(captured).toHaveLength(0);
  });

  test("rejects injected actors, foreign test recipients and unsafe explicit retries before the provider", async () => {
    const input = sample("templates.testSend");
    expect(
      (await http({ ...input, actor: { accountRef: "synthetic-other" } }))
        .statusCode,
    ).toBe(400);
    expect(
      await required(clients.get("owner")).callTool({
        name: "communications_templates_testSend",
        arguments: {
          ...toolArguments(input),
          actor: { accountRef: "synthetic-other" },
        },
      }),
    ).toMatchObject({ isError: true });
    const target = {
      ...input,
      payload: { ...input.payload, telegramIdentityRef: "foreign" },
    };
    expect((await http(target)).statusCode).toBe(400);
    expect(await call(target)).toMatchObject({ isError: true });
    const retry = {
      ...sample("delivery.resolve"),
      payload: {
        deliveryId: randomUUID(),
        partId: randomUUID(),
        action: "retry",
        duplicateRiskAccepted: false,
      },
    };
    expect((await http(retry)).statusCode).toBe(400);
    expect(await call(retry)).toMatchObject({ isError: true });
    expect(captured).toHaveLength(0);
  });

  test("template links only resolve an authorized object; they never fetch their host", async () => {
    const templateId = "22222222-2222-4222-8222-222222222222";
    const input = {
      reference: `https://untrusted.invalid/communications/templates/${templateId}`,
      operationId: randomUUID(),
    };
    nextResponse = { status: 404, body: { ...version, status: "not_found" } };
    expect(
      (await http(input, "owner", "/communications/templates/resolve"))
        .statusCode,
    ).toBe(404);
    expect(
      await required(clients.get("owner")).callTool({
        name: "communications_templates_resolve",
        arguments: input,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "not_found" } },
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      operation: "templates.read",
      payload: { templateId },
      actor: { accountRef: "synthetic-author" },
    });
    expect(
      (
        await http(
          { ...input, reference: "http://127.0.0.1/private" },
          "owner",
          "/communications/templates/resolve",
        )
      ).statusCode,
    ).toBe(400);
    expect(captured).toHaveLength(2);
  });

  for (const scenario of scenarios) {
    test(`vendored consumer scenario: ${scenario.name}`, async () => {
      for (const step of scenario.steps) {
        const request = requestSchema.parse(step.request);
        if (!("accountRef" in request.actor))
          throw new Error("Expected Account fixture");
        const subject =
          request.actor.accountRef === "synthetic-other" ? "other" : "owner";
        const accountId = required(accountIds.get(subject));
        if (step.authorization === "allowed")
          await bootstrapOwnerAccount(
            database.prisma,
            { issuer, subject },
            "communications:manage",
          );
        else
          await database.prisma.accountPermission.deleteMany({
            where: { accountId, permission: "communications:manage" },
          });
        const { actor: _actor, ...input } = request;
        const revision = "revision" in step ? step.revision : undefined;
        nextResponse = {
          status: step.status,
          body:
            step.status === 200
              ? {
                  ...version,
                  status: "ok",
                  template: {
                    templateId: "22222222-2222-4222-8222-222222222222",
                    revision,
                    botIdentity,
                    content,
                  },
                }
              : {
                  ...version,
                  status:
                    step.status === 409
                      ? "revision_conflict"
                      : step.status === 404
                        ? "not_found"
                        : "forbidden",
                },
        };
        const response = await http(input, subject);
        expect(response.statusCode).toBe(step.status);
        const delegated = await call(input, subject);
        expect(delegated).toMatchObject(
          step.status === 200
            ? { structuredContent: response.json<unknown>() }
            : {
                isError: true,
                structuredContent: {
                  ok: false,
                  error: {
                    code: z
                      .object({ code: z.string() })
                      .parse(response.json<unknown>()).code,
                  },
                },
              },
        );
        if (step.authorization === "allowed")
          expect(captured.slice(-2)).toEqual([request, request]);
      }
      await bootstrapOwnerAccount(
        database.prisma,
        { issuer, subject: "owner" },
        "communications:manage",
      );
    });
  }
});

function required<Value>(value: Value | undefined): Value {
  if (value === undefined)
    throw new Error("Missing communications test fixture");
  return value;
}
