import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect, test, vi, type TestContext } from "vitest";
import { z } from "zod";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";

const API_REQUEST_BUDGET_MS = 20_000;

registerFixedClock();

async function listen(
  owner: TestContext,
  handler: RequestListener,
): Promise<string> {
  const server = createServer(handler);
  owner.onTestFinished(async () => {
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
    throw new Error("owned listener unavailable");
  return `http://127.0.0.1:${address.port}`;
}

const spanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  kind: z.number(),
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.object({
        stringValue: z.string().optional(),
        intValue: z.union([z.number(), z.string()]).optional(),
      }),
    }),
  ),
  events: z.array(z.unknown()).optional(),
});
const exportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })),
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
                sum: z
                  .object({
                    dataPoints: z.array(
                      z.object({
                        asDouble: z.number(),
                        attributes: z.array(
                          z.object({
                            key: z.string(),
                            value: z.object({
                              stringValue: z.string().optional(),
                            }),
                          }),
                        ),
                      }),
                    ),
                  })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});

for (const mode of ["enabled", "off", "export-failure"] as const) {
  test(`production video authoring API preserves committed effects and real Kinescope telemetry with ${mode}`, async (owner) => {
    const database = await createMigratedTestDatabase();
    owner.onTestFinished(() => database.dispose());
    const identity = await startTestIdentityIssuer({
      issuer: "https://kinescope-identity.example.test/oidc",
      audience: "https://api.example.test",
    });
    owner.onTestFinished(() => identity.close());
    const actor = await bootstrapOwnerAccount(database.prisma, {
      issuer: identity.issuer,
      subject: "private-owner-subject-sentinel",
    });
    const materialId = randomUUID();
    const providerVideoId = "private-provider-video-sentinel";
    const projectId = "private-project-sentinel";
    const apiToken = "private-provider-token-sentinel";
    const uploadEndpoint =
      "https://uploader.kinescope.io/private-upload-endpoint-sentinel";
    const providerRequests: {
      method: string | undefined;
      path: string | undefined;
      authorization: string | undefined;
      traceparent: string | string[] | undefined;
      body: string;
    }[] = [];
    const providerEndpoint = await listen(owner, (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 16_384) request.destroy();
      });
      request.on("end", () => {
        providerRequests.push({
          method: request.method,
          path: request.url,
          authorization: request.headers.authorization,
          traceparent: request.headers["traceparent"],
          body,
        });
        response.setHeader("content-type", "application/json");
        response.setHeader("x-request-id", "private-provider-request-sentinel");
        if (request.method === "POST" && request.url === "/v2/init") {
          response.end(
            JSON.stringify({
              data: { id: providerVideoId, endpoint: uploadEndpoint },
            }),
          );
        } else if (
          request.method === "GET" &&
          request.url === `/v1/videos/${providerVideoId}`
        ) {
          if (
            providerRequests.filter((item) => item.method === "GET").length ===
            2
          ) {
            response.writeHead(503);
            response.end("private-provider-error-sentinel");
          } else {
            response.end(
              JSON.stringify({
                data: {
                  id: providerVideoId,
                  project_id: projectId,
                  title: "private-reconciled-title-sentinel",
                  status: "done",
                  duration: 120,
                  embed_link: `https://kinescope.io/embed/${providerVideoId}`,
                },
              }),
            );
          }
        } else {
          response.writeHead(400);
          response.end("private-unexpected-request-sentinel");
        }
      });
    });
    const wire: string[] = [];
    let oversizedExport = false;
    const collectorEndpoint = await listen(owner, (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 1_048_576) {
          oversizedExport = true;
          request.destroy();
        }
      });
      request.on("end", () => {
        if (wire.length >= 32) {
          oversizedExport = true;
          request.destroy();
          return;
        }
        wire.push(body);
        response.writeHead(mode === "export-failure" ? 503 : 200, {
          "content-type": "application/json",
          "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT",
        });
        response.end(
          mode === "export-failure" ? "private-exporter-error-sentinel" : "{}",
        );
      });
    });
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    vi.stubEnv("INSIDE_OTEL_ENABLED", mode === "off" ? undefined : "true");
    vi.stubEnv("INSIDE_OTEL_ENDPOINT", collectorEndpoint);
    vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "1");
    owner.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const warnings = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => {
      warnings.mockRestore();
    });
    const information = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => {
      information.mockRestore();
    });
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => {
      errors.mockRestore();
    });
    const parsedConfig = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      LOGTO_ISSUER: identity.issuer,
      LOGTO_AUDIENCE: identity.audience,
      LOGTO_JWKS_URL: identity.jwksUrl,
      IDENTITY_EMAIL_FINGERPRINT_KEY:
        "synthetic-kinescope-identity-fingerprint-secret",
    });
    let application: NestFastifyApplication | undefined;
    owner.onTestFinished(async () => {
      await application?.close();
    });
    // Only this trusted fixture redirects the real production factory to owned HTTP. Environment URL validation remains unchanged.
    application = await createApiApplication(
      {
        ...parsedConfig,
        kinescope: {
          ...parsedConfig.kinescope,
          providerMode: "real",
          apiBaseUrl: providerEndpoint,
          uploaderBaseUrl: providerEndpoint,
          apiToken,
          publicProjectId: projectId,
        },
      },
      { logger: false },
    );
    await application.listen(0, "127.0.0.1");
    const apiEndpoint = await application.getUrl();
    const bearer = await identity.sign("private-owner-subject-sentinel", {
      inside_verified_email: "private-owner-email-sentinel@example.invalid",
    });
    const requestIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ] as const;
    const uploadBody = {
      access: "free",
      byteSize: 42,
      filename: "private-filename-sentinel.mp4",
      title: "private-upload-title-sentinel",
    };
    const post = async (
      path: string,
      requestId: string,
      payload?: typeof uploadBody,
    ) => {
      const response = await fetch(apiEndpoint + path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "x-request-id": requestId,
          ...(payload === undefined
            ? {}
            : {
                "content-type": "application/json",
                "idempotency-key": "private-idempotency-sentinel",
              }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(API_REQUEST_BUDGET_MS),
      });
      const body: unknown = await response.json();
      assertDeclaredResponse({
        method: "POST",
        url: path,
        status: response.status,
        body: () => body,
      });
      return {
        statusCode: response.status,
        json: () => body,
      };
    };
    const uploadRequest = (requestId: string) =>
      post(
        `/authoring/materials/${materialId}/videos/uploads`,
        requestId,
        uploadBody,
      );
    const first = await uploadRequest(requestIds[0]);
    expect(first.statusCode).toBe(201);
    const initialized = z
      .object({
        providerVideoId: z.string(),
        uploadEndpoint: z.string(),
        video: z.object({ videoId: z.uuid(), state: z.string() }),
      })
      .parse(first.json());
    expect(initialized).toMatchObject({
      providerVideoId,
      uploadEndpoint,
      video: { state: "uploading" },
    });
    const committed = await database.prisma.video.findUniqueOrThrow({
      where: { id: initialized.video.videoId },
    });
    expect(committed).toMatchObject({
      materialId,
      createdBy: actor.accountId,
      projectId,
      providerVideoId,
      state: "uploading",
      origin: "platform_upload",
    });
    const attempt = await database.prisma.videoUploadAttempt.findFirstOrThrow({
      where: { materialId },
    });
    expect(attempt).toMatchObject({
      videoId: committed.id,
      status: "ready",
      uploadEndpoint,
    });
    expect(providerRequests).toHaveLength(1);
    const replay = await uploadRequest(requestIds[1]);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(providerRequests).toHaveLength(1);
    expect(
      await database.prisma.videoUploadAttempt.findMany({
        where: { materialId },
      }),
    ).toEqual([attempt]);
    expect(
      await database.prisma.video.findMany({ where: { materialId } }),
    ).toEqual([committed]);
    const reconcileRequest = (requestId: string) =>
      post(`/authoring/videos/${committed.id}/reconcile`, requestId);
    const reconciled = await reconcileRequest(requestIds[2]);
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json()).toMatchObject({
      videoId: committed.id,
      state: "ready",
      durationSeconds: 120,
      title: "private-reconciled-title-sentinel",
    });
    const ready = await database.prisma.video.findUniqueOrThrow({
      where: { id: committed.id },
    });
    expect(ready).toMatchObject({
      state: "ready",
      providerStatus: "done",
      durationSeconds: 120,
    });
    expect(ready.readyAt).not.toBeNull();
    const unavailable = await reconcileRequest(requestIds[3]);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      code: "dependency_unavailable",
    });
    expect(
      await database.prisma.video.findUniqueOrThrow({
        where: { id: committed.id },
      }),
    ).toEqual(ready);
    expect(
      providerRequests.map((request) => [request.method, request.path]),
    ).toEqual([
      ["POST", "/v2/init"],
      ["GET", `/v1/videos/${providerVideoId}`],
      ["GET", `/v1/videos/${providerVideoId}`],
    ]);
    const firstProviderRequest = providerRequests[0];
    if (firstProviderRequest === undefined)
      throw new Error("provider request missing");
    expect(JSON.parse(firstProviderRequest.body)).toEqual({
      parent_id: projectId,
      type: "video",
      filename: uploadBody.filename,
      title: uploadBody.title,
      filesize: 42,
    });
    expect(
      providerRequests.every(
        (request) =>
          request.authorization === `Bearer ${apiToken}` &&
          request.traceparent === undefined,
      ),
    ).toBe(true);
    await application.close();
    application = undefined;
    expect(oversizedExport).toBe(false);
    const rawWire = wire.join("\n");
    for (const secret of [
      "private-",
      materialId,
      actor.accountId,
      committed.id,
      attempt.id,
      providerEndpoint,
      collectorEndpoint,
      apiEndpoint,
      bearer,
    ])
      expect(rawWire).not.toContain(secret);
    expect(JSON.stringify(warnings.mock.calls)).not.toContain(
      "private-exporter-error-sentinel",
    );
    const requestLog = z.object({
      event: z.string(),
      requestId: z.string().optional(),
      traceId: z.string().optional(),
      spanId: z.string().optional(),
    });
    const completedLogs = information.mock.calls
      .map((call) => requestLog.parse(JSON.parse(String(call[0]))))
      .filter((record) => record.event === "request_completed");
    expect(completedLogs).toHaveLength(4);
    expect(new Set(completedLogs.map((record) => record.requestId)).size).toBe(
      4,
    );
    for (const record of completedLogs) {
      expect(z.uuid().safeParse(record.requestId).success).toBe(true);
      expect(requestIds.some((supplied) => supplied === record.requestId)).toBe(
        false,
      );
    }
    if (mode === "off") {
      expect(
        completedLogs.every(
          (record) =>
            record.traceId === undefined && record.spanId === undefined,
        ),
      ).toBe(true);
      expect(wire).toEqual([]);
      return;
    }
    if (mode === "export-failure")
      expect(
        warnings.mock.calls.some((call) =>
          String(call[0]).includes("telemetry_export_failed"),
        ),
      ).toBe(true);
    const exported = wire.map((body) => exportSchema.parse(JSON.parse(body)));
    const spans = exported.flatMap(
      (body) =>
        body.resourceSpans?.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ) ?? [],
    );
    const unique = new Map<string, z.infer<typeof spanSchema>>();
    for (const span of spans) {
      const id = span.traceId + "/" + span.spanId;
      const previous = unique.get(id);
      if (previous !== undefined) expect(span).toEqual(previous);
      unique.set(id, span);
    }
    const logical = [...unique.values()];
    const roots = logical.filter((span) => span.kind === 2);
    const clients = logical.filter((span) => span.kind === 3);
    expect(roots).toHaveLength(4);
    expect(clients).toHaveLength(3);
    expect(clients.map((span) => span.name).sort()).toEqual([
      "kinescope find",
      "kinescope find",
      "kinescope initUpload",
    ]);
    const rootFor = (client: z.infer<typeof spanSchema>) =>
      roots.find(
        (root) =>
          root.traceId === client.traceId &&
          root.spanId === client.parentSpanId,
      );
    for (const client of clients) {
      expect(rootFor(client)?.name).toBe(
        client.name === "kinescope initUpload"
          ? "POST /authoring/materials/:materialId/videos/uploads"
          : "POST /authoring/videos/:videoId/reconcile",
      );
      expect(client.events ?? []).toEqual([]);
    }
    expect(new Set(clients.map((client) => client.parentSpanId)).size).toBe(3);
    const counts = new Map<string, number>();
    for (const metric of exported.flatMap(
      (body) =>
        body.resourceMetrics?.flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) => scope.metrics),
        ) ?? [],
    )) {
      if (metric.name !== "inside.dependency.operations") continue;
      for (const point of metric.sum?.dataPoints ?? []) {
        const attributes = Object.fromEntries(
          point.attributes.map((attribute) => [
            attribute.key,
            attribute.value.stringValue,
          ]),
        );
        expect(attributes["dependency"]).toBe("kinescope");
        expect(Object.keys(attributes).sort()).toEqual([
          "dependency",
          "operation",
          "outcome",
        ]);
        expect(point.asDouble).toBe(1);
        counts.set(
          `${attributes["operation"]}/${attributes["outcome"]}`,
          point.asDouble,
        );
      }
    }
    expect([...counts.entries()].sort()).toEqual([
      ["find/completed", 1],
      ["find/failed", 1],
      ["initUpload/completed", 1],
    ]);
    for (const record of completedLogs) {
      expect(
        roots.some(
          (span) =>
            span.traceId === record.traceId && span.spanId === record.spanId,
        ),
      ).toBe(true);
    }
  });
}
