import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { z } from "zod";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { writeLog } from "../../src/infrastructure/observability/log.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { refusingLearnerMcpDependencies } from "../fixtures/learner-mcp.js";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  createMcpHttpServer,
  type McpHttpServer,
} from "../../src/entrypoints/mcp/mcp-http-server.js";
import type { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import type { Accounts } from "../../src/modules/accounts/index.js";
import { createLogtoAccessTokenVerifier } from "../../src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.js";
import { readCommittedToolSurface } from "../../scripts/mcp-tool-surface-file.js";
import { refusingMcpToolDependencies } from "../fixtures/inside-mcp-dependencies.js";

registerFixedClock();

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("MCP Streamable HTTP adapter", () => {
  let privateKey: CryptoKey;
  let endpoint: URL;
  let server: McpHttpServer;

  beforeAll(async () => {
    const keys = await generateKeyPair("ES384");
    privateKey = keys.privateKey;
    const publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      alg: "ES384",
      kid: "mcp-http-test-key",
    };
    server = createMcpHttpServer({
      accounts: fakeAccounts(),
      learning: refusingLearnerMcpDependencies(),
      ...refusingMcpToolDependencies(),
      config: {
        host: "127.0.0.1",
        port: 0,
        serverUrl: "http://127.0.0.1:0/mcp",
      },
      identityIssuer: issuer,
      readiness: fakeReadiness(),
      tokenVerifier: createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwks: { keys: [publicJwk] },
      }),
    });
    endpoint = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  test("serves authenticated tools over Streamable HTTP", async () => {
    const client = new Client({ name: "mcp-http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      authProvider: { token: () => signToken("owner-001") },
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      // Состав набора живёт в сгенерированном слепке; здесь доказывается, что вход отдаёт ровно его.
      expect(tools.map(({ name }) => name).sort()).toEqual(
        readCommittedToolSurface(),
      );
      expect(tools.map(({ name }) => name)).not.toContain(
        "billing_refunds_execute",
      );
      expect(tools.map(({ name }) => name)).not.toContain(
        "billing_refunds_decide",
      );
      expect(
        tools.find((tool) => tool.name === "billing_refunds_read")?.annotations,
      ).toMatchObject({ readOnlyHint: true });
      expect(
        tools.find((tool) => tool.name === "billing_offers_publish")
          ?.annotations,
      ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(
        tools.find((tool) => tool.name === "billing_offers_list")?.annotations,
      ).toMatchObject({ readOnlyHint: true });
      expect(
        tools.find((tool) => tool.name === "billing_payments_read")
          ?.annotations,
      ).toMatchObject({ readOnlyHint: true });
      expect(
        tools.find((tool) => tool.name === "billing_grants_readClassification")
          ?.annotations,
      ).toMatchObject({ readOnlyHint: true });
      expect(
        tools.find((tool) => tool.name === "billing_grants_classify")
          ?.annotations,
      ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    } finally {
      await client.close();
    }
  });

  test("isolates the authenticated learner endpoint and its discovery metadata", async () => {
    const learning = new URL(`${endpoint.pathname}/learning`, endpoint);
    const client = new Client({ name: "learning-http", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(learning, {
          authProvider: { token: () => signLearningToken("owner-001") },
        }),
      );
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name).sort()).toEqual([
        "learning_material_read",
        "learning_materials_list",
        "learning_practice_read",
        "learning_task_read",
        "learning_task_review_update",
        "learning_task_submissions",
        "learning_task_submit",
        "learning_tasks_list",
      ]);
      await expect(
        client.callTool({ name: "material_create_draft", arguments: {} }),
      ).rejects.toThrow("not found");
      const metadata = await fetch(
        new URL("/.well-known/oauth-protected-resource/mcp/learning", endpoint),
      );
      await expect(metadata.json()).resolves.toEqual({
        resource: "http://127.0.0.1:0/mcp/learning",
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
        scopes_supported: ["learning:read"],
        resource_name: "Sachkov Inside learning materials",
      });
      const authoring = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await signLearningToken("owner-001")}`,
        },
        body: "{}",
      });
      expect(authoring.status).toBe(401);
    } finally {
      await client.close();
    }
  });

  test("asks a learner client without a token to sign in, without an error code", async () => {
    const rejected = await postLearning(undefined);

    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("cache-control")).toBe("private, no-store");
    const challenge = rejected.headers.get("www-authenticate") ?? "";
    expect(challenge).toBe(
      'Bearer resource_metadata="http://127.0.0.1:0/.well-known/oauth-protected-resource/mcp/learning", scope="learning:read"',
    );
  });

  test("rejects a learner token that is invalid or issued for another resource", async () => {
    const cases = [
      "not-a-jwt",
      await signToken("owner-001", { scope: "learning:read" }),
      await signToken("owner-001", {
        audience: "https://other.example.test/mcp/learning",
        scope: "learning:read",
      }),
      await signLearningToken("owner-001", { expiresAt: currentTime() - 60 }),
      await signLearningToken("unknown-account"),
    ];

    for (const token of cases) {
      const response = await postLearning(token);
      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate") ?? "";
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain('resource_metadata="http://127.0.0.1:');
      expect(challenge).toContain('scope="learning:read"');
    }
  });

  test("refuses a learner token without the learning scope", async () => {
    const response = await postLearning(
      await signLearningToken("owner-001", { scope: "openid" }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="learning:read"',
    );
  });

  test("challenges missing, invalid, expired, and unknown-Account proofs", async () => {
    const cases = [
      undefined,
      "not-a-jwt",
      await signToken("owner-001", { expiresAt: currentTime() - 60 }),
      await signToken("unknown-account"),
    ];

    for (const token of cases) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        "resource_metadata=",
      );
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_token",
      });
    }
  });

  test("publishes Logto-compatible protected resource metadata", async () => {
    const metadataUrl = new URL(
      "/.well-known/oauth-protected-resource/mcp",
      endpoint,
    );
    const response = await fetch(metadataUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: "http://127.0.0.1:0/mcp",
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource_name: "Sachkov Inside Platform authoring",
    });
  });

  test("reports release-aware readiness without MCP authentication", async () => {
    const response = await fetch(new URL("/_health/ready", endpoint));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      process: "mcp",
      release: { release: "test" },
      status: "ready",
    });
  });

  test("rejects an untrusted browser Origin before authentication", async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { origin: "https://attacker.example.test" },
      body: "{}",
    });

    expect(response.status).toBe(403);
  });

  function postLearning(token: string | undefined): Promise<Response> {
    return fetch(new URL(`${endpoint.pathname}/learning`, endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: "{}",
    });
  }

  function signLearningToken(
    subject: string,
    overrides: { readonly expiresAt?: number; readonly scope?: string } = {},
  ): Promise<string> {
    return signToken(subject, {
      audience: "http://127.0.0.1:0/mcp/learning",
      scope: "openid offline_access learning:read",
      ...overrides,
    });
  }

  function signToken(
    subject: string,
    overrides: {
      readonly expiresAt?: number;
      readonly audience?: string;
      readonly scope?: string;
    } = {},
  ): Promise<string> {
    const issuedAt = currentTime();
    return new SignJWT(
      overrides.scope === undefined ? {} : { scope: overrides.scope },
    )
      .setProtectedHeader({ alg: "ES384", kid: "mcp-http-test-key" })
      .setIssuer(issuer)
      .setAudience(overrides.audience ?? audience)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(overrides.expiresAt ?? issuedAt + 300)
      .sign(privateKey);
  }
});

function fakeAccounts(): Accounts {
  return {
    readIdentityForLink: () => Promise.resolve(undefined),
    readIdentitiesForLink: (ids) =>
      Promise.resolve(new Map(ids.map((id) => [id, undefined]))),
    establishAccount: () =>
      Promise.resolve({
        ok: false,
        error: { code: "invalid_input" },
      }),
    resolveAccount: ({ identity }) =>
      Promise.resolve(
        identity.subject === "owner-001"
          ? { ok: true, account: { accountId } }
          : { ok: false, error: { code: "account_not_found" } },
      ),
    checkPermission: () => Promise.resolve({ ok: true, allowed: false }),
  };
}

function fakeReadiness(): Pick<OperationalReadiness, "check" | "live"> {
  return {
    check: () =>
      Promise.resolve({
        database: "reachable" as const,
        process: "mcp" as const,
        release: { release: "test", sourceSha: "0".repeat(40) },
        schema: { identity: `sha256:${"0".repeat(64)}`, migrationCount: 20 },
        status: "ready" as const,
      }),
    live: () => ({
      process: "mcp" as const,
      release: { release: "test", sourceSha: "0".repeat(40) },
      status: "alive" as const,
    }),
  };
}

function currentTime(): number {
  // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
  return Math.floor(Date.now() / 1_000);
}

describe("MCP technical HTTP telemetry", () => {
  test("counts health, denied and unknown routes with safe templates and async log context", async () => {
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const technicalTelemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-mcp",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: { spans, metrics },
    });
    let server: McpHttpServer | undefined;
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      server = createMcpHttpServer({
        ...refusingMcpToolDependencies(),
        accounts: fakeAccounts(),
        learning: refusingLearnerMcpDependencies(),
        config: {
          host: "127.0.0.1",
          port: 0,
          serverUrl: "http://127.0.0.1:0/mcp",
        },
        identityIssuer: issuer,
        readiness: {
          ...fakeReadiness(),
          check: async () => {
            await Promise.resolve();
            writeLog("info", "mcp_readiness_checked");
            throw new Error("token=sentinel-private");
          },
        },
        tokenVerifier: createLogtoAccessTokenVerifier({
          issuer,
          audience,
          jwks: { keys: [] },
        }),
        technicalTelemetry,
      });
      const endpoint = await server.listen();
      const responses = await Promise.all([
        fetch(new URL("/_health/live", endpoint)),
        fetch(new URL("/_health/ready", endpoint)),
        fetch(new URL("/mcp?token=sentinel-query", endpoint), {
          method: "POST",
          headers: {
            authorization: "Bearer sentinel-token",
            baggage: "private=sentinel-baggage",
            traceparent:
              "00-11111111111111111111111111111111-1111111111111111-01",
          },
          body: "{}",
        }),
        fetch(new URL("/sentinel-path", endpoint)),
        fetch(endpoint, {
          headers: { origin: "https://sentinel-origin.invalid" },
        }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([
        200, 503, 401, 404, 403,
      ]);
      await technicalTelemetry.flush();
      const finished = spans.getFinishedSpans();
      expect(finished).toHaveLength(5);
      expect(
        finished.map((span) => span.attributes["http.route"]).sort(),
      ).toEqual(
        ["/_health/live", "/_health/ready", "/mcp", "/mcp", "unmatched"].sort(),
      );
      expect(
        new Set(finished.map((span) => span.spanContext().traceId)).size,
      ).toBe(5);
      expect(
        finished.some(
          (span) =>
            span.spanContext().traceId === "11111111111111111111111111111111",
        ),
      ).toBe(false);
      const log = logs.mock.calls.find((call) =>
        String(call[0]).includes("mcp_readiness_checked"),
      );
      const correlation = z
        .object({
          traceId: z.string(),
          spanId: z.string(),
          requestId: z.string(),
          service: z.literal("platform-mcp"),
        })
        .parse(JSON.parse(String(log?.[0])));
      expect(
        finished
          .find((span) => span.attributes["http.route"] === "/_health/ready")
          ?.spanContext().traceId,
      ).toBe(correlation.traceId);
      const exported = metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        );
      const counts = exported.find(
        (metric) => metric.descriptor.name === "http.server.request.count",
      );
      expect(
        counts?.dataPoints.reduce((sum, point) => sum + Number(point.value), 0),
      ).toBe(5);
      expect(
        JSON.stringify({
          spans: finished.map((span) => ({
            name: span.name,
            attributes: span.attributes,
            status: span.status,
            events: span.events,
          })),
          metrics: exported,
          logs: logs.mock.calls,
        }),
      ).not.toContain("sentinel-");
    } finally {
      await server?.close();
      await technicalTelemetry.shutdown();
      logs.mockRestore();
      errors.mockRestore();
    }
  });
});
