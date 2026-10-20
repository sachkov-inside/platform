import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { createS3ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  assertPrivateS3Exports,
  summarizeS3Attempts,
} from "../support/s3-api-diagnostics.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

registerFixedClock();

const attributesSchema = z.array(
  z.object({
    key: z.string(),
    value: z.object({
      stringValue: z.string().optional(),
      intValue: z.union([z.string(), z.number()]).optional(),
    }),
  }),
);
const spanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  kind: z.number(),
  name: z.string(),
  attributes: attributesSchema,
});
const pointSchema = z.object({
  attributes: attributesSchema,
  asDouble: z.number().optional(),
  count: z.union([z.string(), z.number()]).optional(),
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
                sum: z.object({ dataPoints: z.array(pointSchema) }).optional(),
                histogram: z
                  .object({ dataPoints: z.array(pointSchema) })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});

const body = Buffer.from("private-s3-api-body-sentinel\n");
const filename = "private-s3-api-file-sentinel.txt";
const checksum = createHash("sha256").update(body).digest("hex");
const buckets = {
  protected: "private-s3-proof-protected",
  public: "private-s3-proof-public",
  quarantine: "private-s3-proof-quarantine",
} as const;
const credentials = {
  accessKeyId: "private-s3-proof-access",
  secretAccessKey: "private-s3-proof-secret",
} as const;
const releases: (() => Promise<void>)[] = [];
let application: NestFastifyApplication | undefined;
let materialId: string;
let assetId: string;
let actor: string;
let contentVersion: number;
let storageEndpoint: string;
let publicKey: string;
let protectedKey: string;
const exported: string[] = [];
const captureFailures: unknown[] = [];

// API shutdown flushes the SDK before its owned collector closes. Independent releases still run after any failure.
afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await application?.close();
  } catch (error) {
    failures.push(error);
  }
  const outcomes = await Promise.allSettled(
    releases.map((release) => release()),
  );
  for (const result of outcomes)
    if (result.status === "rejected") failures.push(result.reason);
  if (failures.length > 0)
    throw new AggregateError(failures, "Owned S3 API proof cleanup failed");
});

// Real migrated PostgreSQL and pinned RustFS startup belong to preparation, outside the delivery observation.
beforeAll(async () => {
  const database = await createMigratedTestDatabase();
  releases.push(() => database.dispose());
  const rustfs = await new GenericContainer(
    "ghcr.io/rustfs/rustfs:1.0.0@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff",
  )
    .withEnvironment({
      RUSTFS_ACCESS_KEY: credentials.accessKeyId,
      RUSTFS_SECRET_KEY: credentials.secretAccessKey,
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/health", 9000))
    .start();
  releases.push(async () => {
    await rustfs.stop();
  });
  storageEndpoint = `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`;
  const storageConfig = {
    buckets,
    credentials,
    endpoint: storageEndpoint,
    forcePathStyle: true,
    region: "us-east-1",
  } as const;
  const client = new S3Client(storageConfig);
  releases.push(() => {
    client.destroy();
    return Promise.resolve();
  });
  for (const Bucket of Object.values(buckets))
    await client.send(new CreateBucketCommand({ Bucket }));
  const storage = createS3ObjectStorage(storageConfig);
  const assets = assembleMaterialAssets({
    objectStorage: storage,
    prisma: database.prisma,
  });
  actor = randomUUID();
  const materials = assembleMaterials({
    authorPolicy: { canManage: (id) => id === actor },
    materialAssets: assets,
    prisma: database.prisma,
  });
  const topicId = randomUUID();
  await database.prisma.topic.create({
    data: {
      id: topicId,
      slug: "s3-api-proof-topic",
      name: "S3 API proof",
    },
  });
  const source = {
    id: "s3-api-proof:public-file",
    path: "lessons/s3-api-proof.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const reserved = await materials.authoring.reserveSourceMaterial({
    actor,
    source,
  });
  if (!reserved.ok) throw new Error(reserved.error.code);
  materialId = reserved.value.materialId;
  const uploaded = await assets.upload({
    actor,
    body,
    declaredContentType: "text/plain",
    declaredSize: body.byteLength,
    expectedChecksumSha256: checksum,
    filename,
    idempotencyKey: "s3-api-proof-upload",
    kind: "file",
    materialId,
  });
  if (!uploaded.ok) throw new Error(uploaded.error.code);
  assetId = uploaded.value.assetId;
  const published = await materials.authoring.applySourceMaterial({
    actor,
    idempotencyKey: "s3-api-proof-publish",
    source,
    materialId,
    expectedContentVersion: reserved.value.contentVersion,
    publicationState: "published",
    primaryVideoId: null,
    metadata: {
      title: "S3 API proof",
      summary: "Public file delivery",
      access: "free",
      topicId,
      formatId: "guide",
      tagIds: [],
      seriesIds: [],
      difficulty: null,
      outcomes: [],
    },
    body: {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "assetFile",
            attrs: { nodeId: randomUUID(), assetId, label: "Download" },
          },
        ],
      },
    },
  });
  if (!published.ok) throw new Error(published.error.code);
  contentVersion = published.value.contentVersion;
  const delivery = await assets.loadDelivery({ materialId, assetId });
  if (
    !delivery.ok ||
    delivery.value?.object.publicKey === null ||
    delivery.value === null
  )
    throw new Error("Published file delivery locators unavailable");
  publicKey = delivery.value.object.publicKey;
  protectedKey = delivery.value.object.protectedKey;

  let capturedBytes = 0;
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      capturedBytes += chunk.byteLength;
      if (bytes > 1_048_576 || capturedBytes > 4_194_304) {
        captureFailures.push(new Error("OTLP capture byte budget exceeded"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", (error) => captureFailures.push(error));
    request.on("end", () => {
      if (exported.length >= 32) {
        captureFailures.push(
          new Error("OTLP capture document budget exceeded"),
        );
        response.writeHead(413).end();
        return;
      }
      exported.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  releases.push(async () => {
    collector.closeAllConnections();
    if (collector.listening)
      await new Promise<void>((resolve, reject) =>
        collector.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  const address = collector.address();
  if (address === null || typeof address === "string")
    throw new Error("Owned collector unavailable");
  // Register restoration before any environment mutation, including partial setup failures.
  releases.push(() => {
    vi.unstubAllEnvs();
    return Promise.resolve();
  });
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  vi.stubEnv("INSIDE_OTEL_ENABLED", "true");
  vi.stubEnv("INSIDE_OTEL_ENDPOINT", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "1");
  const config = parsePlatformConfig({
    NODE_ENV: "test",
    DATABASE_URL: database.url,
    IDENTITY_EMAIL_FINGERPRINT_KEY: "synthetic-s3-api-proof-fingerprint-key",
    OBJECT_STORAGE_ENDPOINT: storageEndpoint,
    OBJECT_STORAGE_REGION: "us-east-1",
    OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
    OBJECT_STORAGE_ACCESS_KEY_ID: credentials.accessKeyId,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    OBJECT_STORAGE_PUBLIC_BUCKET: buckets.public,
    OBJECT_STORAGE_PROTECTED_BUCKET: buckets.protected,
    OBJECT_STORAGE_QUARANTINE_BUCKET: buckets.quarantine,
  });
  expect(config.communications).toBeUndefined();
  expect(config.communityEntitlements).toBeUndefined();
  application = await createApiApplication(config, { logger: false });
  await application.listen(0, "127.0.0.1");
}, 120_000);

test("public file delivery through production API parents one complete private-safe RustFS read", async () => {
  if (application === undefined) throw new Error("Owned API unavailable");
  // The API owns a fresh ObjectStorage instance. Setup never reads its cache or invokes its delivery path.
  const response = await fetch(
    `${await application.getUrl()}/materials/${materialId}/assets/${assetId}?contentVersion=${contentVersion}`,
    { signal: AbortSignal.timeout(20_000), redirect: "error" },
  );
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  expect(response.headers.get("content-type")).toBe("text/plain");
  expect(response.headers.get("content-length")).toBe(String(body.byteLength));
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  await application.close();
  application = undefined;
  assertPrivateS3Exports(exported, [
    "private-",
    body.toString("utf8").trim(),
    filename,
    checksum,
    ...Object.values(buckets),
    ...Object.values(credentials),
    storageEndpoint,
    actor,
    materialId,
    assetId,
    publicKey,
    protectedKey,
  ]);
  expect(captureFailures.length).toBe(0);
  const documents = exported.map((raw) => {
    // The privacy gate validates JSON first; retain schema checking without raw Zod diffs.
    const document = exportSchema.safeParse(JSON.parse(raw));
    if (!document.success)
      throw new Error("S3 API export schema validation failed");
    return document.data;
  });
  const spans = documents.flatMap(
    (value) =>
      value.resourceSpans?.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ) ?? [],
  );
  const logical = [
    ...new Map(
      spans.map((span) => [span.traceId + "/" + span.spanId, span]),
    ).values(),
  ];
  const attribute = (span: z.infer<typeof spanSchema>, key: string) =>
    span.attributes.find((item) => item.key === key)?.value;
  const storageSpans = logical.filter(
    (span) => attribute(span, "dependency.name")?.stringValue === "s3",
  );
  expect(
    storageSpans.length,
    storageSpans.length === 2 ? undefined : summarizeS3Attempts(logical),
  ).toBe(2);
  const read = storageSpans.find((span) => span.name === "s3 getObject.read");
  const http = storageSpans.find((span) => span.name === "s3 http.GET");
  if (read === undefined || http === undefined)
    throw new Error("Missing complete S3 read chain");
  expect(read.kind).toBe(1);
  expect(http.kind).toBe(3);
  expect(http.traceId).toBe(read.traceId);
  expect(http.parentSpanId).toBe(read.spanId);
  for (const span of [read, http])
    expect(attribute(span, "dependency.outcome")?.stringValue).toBe(
      "completed",
    );
  expect(read.attributes.map((item) => item.key).sort()).toEqual([
    "dependency.name",
    "dependency.operation",
    "dependency.outcome",
  ]);
  expect(http.attributes.map((item) => item.key).sort()).toEqual([
    "dependency.name",
    "dependency.operation",
    "dependency.outcome",
    "http.request.method",
    "http.response.status_code",
  ]);
  expect(attribute(read, "dependency.operation")?.stringValue).toBe(
    "getObject.read",
  );
  expect(attribute(http, "dependency.operation")?.stringValue).toBe("http.GET");
  expect(attribute(http, "http.request.method")?.stringValue).toBe("GET");
  expect(String(attribute(http, "http.response.status_code")?.intValue)).toBe(
    "200",
  );
  const parent = logical.find(
    (span) =>
      span.kind === 2 &&
      span.traceId === read.traceId &&
      span.spanId === read.parentSpanId,
  );
  if (parent === undefined) throw new Error("Missing actual API SERVER parent");
  expect(attribute(parent, "http.route")?.stringValue).toBe(
    "/materials/:materialId/assets/:assetId",
  );
  expect(String(attribute(parent, "http.response.status_code")?.intValue)).toBe(
    "200",
  );
  const metrics = documents.flatMap(
    (value) =>
      value.resourceMetrics?.flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      ) ?? [],
  );
  for (const name of [
    "inside.dependency.operations",
    "inside.dependency.duration",
  ]) {
    const points = metrics
      .filter((metric) => metric.name === name)
      .flatMap(
        (metric) =>
          metric.sum?.dataPoints ?? metric.histogram?.dataPoints ?? [],
      )
      .filter((point) =>
        point.attributes.some(
          (item) =>
            item.key === "dependency" && item.value.stringValue === "s3",
        ),
      );
    expect(points.length).toBeGreaterThan(0);
    const operations = new Set<string>();
    for (const point of points) {
      expect(point.attributes.map((item) => item.key).sort()).toEqual([
        "dependency",
        "operation",
        "outcome",
      ]);
      const operation = point.attributes.find(
        (item) => item.key === "operation",
      )?.value.stringValue;
      if (operation === undefined)
        throw new Error("Missing S3 metric operation");
      operations.add(operation);
      expect(
        point.attributes.find((item) => item.key === "outcome")?.value
          .stringValue,
      ).toBe("completed");
      expect(
        name === "inside.dependency.operations"
          ? point.asDouble
          : Number(point.count),
      ).toBe(1);
    }
    expect([...operations].sort()).toEqual(["getObject.read", "http.GET"]);
  }
});
