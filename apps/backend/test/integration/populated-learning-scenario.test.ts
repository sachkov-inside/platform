import { reportLearningStage } from "./setup/populated-learning-observation.js";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import { bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { seedLearningScenario } from "../../../../scenarios/seed-learning.mjs";
import { seedReadingFeedScenario } from "../../../../scenarios/seed-reading-feed.mjs";
import { scenarioRoles } from "../../../../scenarios/roles.mjs";
import { seedLegacyMaterialAssets } from "../../../../scenarios/seed-legacy-assets.mjs";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { materialSchema } from "../../src/modules/materials/adapters/nest/material-authoring-http.js";
import { startIsolatedTelegramProvider } from "../../src/development/start-isolated-telegram-provider.js";
import { seedCommerceScenario } from "../../../../scenarios/seed-commerce.mjs";
import { createIsolatedProductIntake } from "../../src/development/create-isolated-product-intake.js";
import { reservePort } from "../../../../scripts/smoke-stand.mjs";
import { startLocalBankDouble } from "../../src/development/bank-double/start-local-bank-double.js";
import { localTbankConfig } from "../../src/config/tbank-config.js";
import { fullStackOfflineServices } from "../../../../scripts/full-stack-environment.mjs";

registerFixedClock();
let database: TestDatabase;
let storage: StartedTestContainer;
const storageCredentials = {
  accessKeyId: "synthetic-learning-access-key",
  secretAccessKey: "synthetic-learning-secret-key",
};
const storageBuckets = {
  public: "synthetic-learning-public",
  protected: "synthetic-learning-protected",
  quarantine: "synthetic-learning-quarantine",
};
let identity: TestIdentityIssuer;
let app: NestFastifyApplication;
let api: string;
let ownerToken: string;
let holderToken: string;
let seeded: Awaited<ReturnType<typeof seedLearningScenario>>;
let telegram: Awaited<ReturnType<typeof startIsolatedTelegramProvider>>;
const cleanups: {
  readonly stage:
    | "cleanup:database"
    | "cleanup:rustfs"
    | "cleanup:identity"
    | "cleanup:telegram"
    | "cleanup:bank"
    | "cleanup:api";
  readonly run: () => Promise<unknown>;
}[] = [];
beforeAll(async () => {
  reportLearningStage("beforeAll", "start");
  reportLearningStage("database", "start");
  database = await createMigratedTestDatabase();
  cleanups.push({ stage: "cleanup:database", run: () => database.dispose() });
  reportLearningStage("database", "end");
  reportLearningStage("rustfs-start-health", "start");
  storage = await new GenericContainer(
    "ghcr.io/rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74",
  )
    .withEnvironment({
      RUSTFS_ACCESS_KEY: storageCredentials.accessKeyId,
      RUSTFS_SECRET_KEY: storageCredentials.secretAccessKey,
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/health", 9000))
    .start();
  cleanups.push({ stage: "cleanup:rustfs", run: () => storage.stop() });
  reportLearningStage("rustfs-start-health", "end");
  const storageEndpoint = `http://${storage.getHost()}:${String(storage.getMappedPort(9000))}`;
  const client = new S3Client({
    endpoint: storageEndpoint,
    region: "us-east-1",
    credentials: storageCredentials,
    forcePathStyle: true,
  });
  reportLearningStage("s3-buckets", "start");
  try {
    for (const Bucket of Object.values(storageBuckets))
      await client.send(new CreateBucketCommand({ Bucket }));
  } finally {
    client.destroy();
  }
  reportLearningStage("s3-buckets", "end");
  reportLearningStage("identity-issuer", "start");
  identity = await startTestIdentityIssuer({
    issuer: "https://learning-scenarios.invalid/oidc",
    audience: "https://learning-scenarios.invalid/api",
  });
  cleanups.push({ stage: "cleanup:identity", run: () => identity.close() });
  reportLearningStage("identity-issuer", "end");
  reportLearningStage("bootstrap-owner", "start");
  await bootstrapOwnerAccount(
    database.prisma,
    { issuer: identity.issuer, subject: scenarioRoles.owner.subject },
    "platform:admin",
  );
  reportLearningStage("bootstrap-owner", "end");
  reportLearningStage("owner-token", "start");
  ownerToken = await identity.sign(scenarioRoles.owner.subject);
  reportLearningStage("owner-token", "end");
  reportLearningStage("telegram-provider", "start");
  telegram = await startIsolatedTelegramProvider({
    databaseName: new URL(database.url).pathname.slice(1),
  });
  cleanups.push({ stage: "cleanup:telegram", run: () => telegram.close() });
  reportLearningStage("telegram-provider", "end");
  reportLearningStage("api-port", "start");
  const apiPort = await reservePort();
  reportLearningStage("api-port", "end");
  reportLearningStage("bank-port", "start");
  const bankPort = await reservePort();
  reportLearningStage("bank-port", "end");
  const bankEnvironment = {
    TBANK_PROVIDER_MODE: "test",
    TBANK_TEST_API_BASE_URL: `http://127.0.0.1:${String(bankPort)}/v2`,
    TBANK_TEST_PUBLIC_ORIGIN: `http://127.0.0.1:${String(bankPort)}`,
    TBANK_TEST_NOTIFICATION_URL: `http://127.0.0.1:${String(apiPort)}/billing/tbank/notification`,
    TBANK_TEST_RETURN_URL: `http://127.0.0.1:${String(apiPort)}/payment/return`,
  };
  reportLearningStage("bank-provider", "start");
  const bank = await startLocalBankDouble({
    config: localTbankConfig(bankEnvironment),
    host: "127.0.0.1",
    port: bankPort,
  });
  cleanups.push({ stage: "cleanup:bank", run: () => bank.close() });
  reportLearningStage("bank-provider", "end");
  reportLearningStage("create-api-application", "start");
  app = await createApiApplication(
    parsePlatformConfig({
      OBJECT_STORAGE_ENDPOINT: storageEndpoint,
      OBJECT_STORAGE_ACCESS_KEY_ID: storageCredentials.accessKeyId,
      OBJECT_STORAGE_SECRET_ACCESS_KEY: storageCredentials.secretAccessKey,
      OBJECT_STORAGE_PUBLIC_BUCKET: storageBuckets.public,
      OBJECT_STORAGE_PROTECTED_BUCKET: storageBuckets.protected,
      OBJECT_STORAGE_QUARANTINE_BUCKET: storageBuckets.quarantine,
      OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      LOGTO_ISSUER: identity.issuer,
      LOGTO_AUDIENCE: identity.audience,
      LOGTO_JWKS_URL: identity.jwksUrl,
      IDENTITY_EMAIL_FINGERPRINT_KEY:
        "synthetic-learning-email-fingerprint-key",
      ...telegram.environment,
      ...fullStackOfflineServices,
      ...bankEnvironment,
    }),
    { logger: false },
  );
  cleanups.push({ stage: "cleanup:api", run: () => app.close() });
  reportLearningStage("create-api-application", "end");

  reportLearningStage("api-listen", "start");
  await app.listen(apiPort, "127.0.0.1");
  reportLearningStage("api-listen", "end");
  reportLearningStage("api-url", "start");
  api = await app.getUrl();
  reportLearningStage("api-url", "end");
  reportLearningStage("holder-token", "start");
  holderToken = await identity.sign(scenarioRoles.holder.subject, {
    inside_verified_email: "light-holder@inside.test",
  });
  reportLearningStage("holder-token", "end");
  reportLearningStage("accounts-http", "start");
  await fetch(`${api}/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${holderToken}` },
  });
  reportLearningStage("accounts-http", "end");
  reportLearningStage("reading-feed-seed", "start");
  await seedReadingFeedScenario({
    api,
    databaseName: new URL(database.url).pathname.slice(1),
    ownerToken,
  });
  reportLearningStage("reading-feed-seed", "end");
  reportLearningStage("learning-seed", "start");
  seeded = await seedLearningScenario({
    api,
    databaseName: new URL(database.url).pathname.slice(1),
    ownerToken,
    holderToken,
  });
  reportLearningStage("learning-seed", "end");
  reportLearningStage("beforeAll", "end");
});

test("the isolated library has a complete public feed, format filters and cursor continuation without legacy seed data", async () => {
  const pageSchema = z.object({
    items: z.array(
      z.object({
        materialId: z.uuid(),
        access: z.string(),
        format: z.object({ slug: z.string() }),
        topic: z.object({ slug: z.string() }),
        productMemberships: z.array(z.unknown()),
      }),
    ),
    totalCount: z.number(),
    nextCursor: z.string().nullable(),
  });
  const read = async (query: URLSearchParams) => {
    const response = await fetch(
      `${api}/library/materials?${query.toString()}`,
    );
    expect(response.status).toBe(200);
    return pageSchema.parse(await response.json());
  };
  const query = new URLSearchParams({
    feedOnly: "true",
    topic: "navigation-topic",
  });
  const first = await read(query);
  expect(first.totalCount).toBe(120);
  expect(first.items).toHaveLength(12);
  expect(first.nextCursor).toEqual(expect.any(String));
  const items = [...first.items];
  let cursor = first.nextCursor;
  while (cursor !== null) {
    expect(items.length).toBeLessThan(120);
    query.set("after", cursor);
    const page = await read(query);
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  expect(items).toHaveLength(120);
  expect(new Set(items.map((item) => item.materialId)).size).toBe(120);
  expect(new Set(items.map((item) => item.access))).toEqual(new Set(["free"]));
  expect(new Set(items.map((item) => item.topic.slug))).toEqual(
    new Set(["navigation-topic"]),
  );
  expect(items.every((item) => item.productMemberships.length === 0)).toBe(
    true,
  );
  expect(items.filter((item) => item.format.slug === "video")).toHaveLength(60);
  expect(items.filter((item) => item.format.slug === "guide")).toHaveLength(60);
  for (const format of ["video", "guide"]) {
    const filtered = await read(
      new URLSearchParams({
        feedOnly: "true",
        topic: "navigation-topic",
        format,
      }),
    );
    expect(filtered.totalCount).toBe(60);
    expect(new Set(filtered.items.map((item) => item.format.slug))).toEqual(
      new Set([format]),
    );
  }
  const empty = await read(
    new URLSearchParams({ feedOnly: "true", topic: "synthetic-learning" }),
  );
  expect(empty).toMatchObject({ totalCount: 0, items: [], nextCursor: null });
});

test("the unpaid learner has real linked contacts, explicit waitlist membership and a pending purchase", async () => {
  const token = await identity.sign(scenarioRoles.learner.subject, {
    inside_verified_email: "light-learner@inside.test",
  });
  const commerce = await seedCommerceScenario({
    api,
    databaseName: new URL(database.url).pathname.slice(1),
    ownerToken,
    productId: seeded.productId,
    buyerToken: token,
    completeTelegramLink: async (deepLink) => {
      const completed = await fetch(
        new URL(
          "/__scenario/complete",
          telegram.environment.TELEGRAM_LINKING_ENDPOINT,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${telegram.environment.TELEGRAM_LINKING_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ deepLink }),
        },
      );
      expect(completed.status).toBe(200);
    },
    createIntake: () =>
      createIsolatedProductIntake({
        databaseUrl: database.url,
        productId: seeded.productId,
      }),
  });
  const people = await fetch(
    `${api}/authoring/people?query=light-learner%40inside.test`,
    {
      headers: { authorization: `Bearer ${ownerToken}` },
    },
  );
  expect(people.status).toBe(200);
  expect(await people.json()).toMatchObject({
    items: [
      {
        displayName: "Участник Тестов",
        username: "synthetic_learner",
        email: null,
        contactsState: "complete",
        telegram: "linked",
      },
    ],
  });
  const receipt = await fetch(
    `${api}/billing/admin/payments/${commerce.purchaseRef}/order-email`,
    {
      headers: { authorization: `Bearer ${ownerToken}` },
    },
  );
  expect(receipt.status).toBe(200);
  expect(await receipt.json()).toEqual({ email: "light-learner@inside.test" });
  const contact = await fetch(`${api}/accounts/current/billing/contact`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(contact.status).toBe(200);
  expect(await contact.json()).toMatchObject({ ok: true, contact: null });
  const searched = await fetch(
    `${api}/authoring/people?query=%40synthetic_learner`,
    {
      headers: { authorization: `Bearer ${ownerToken}` },
    },
  );
  expect(searched.status).toBe(200);
  expect(await searched.json()).toMatchObject({
    nameSearch: "available",
    items: [{ displayName: "Участник Тестов", username: "synthetic_learner" }],
  });
  const intake = await fetch(
    `${api}/product-waitlists/${seeded.productId}/intake`,
  );
  expect(intake.status).toBe(200);
  expect(await intake.json()).toEqual({
    intakeId: "97000000-0000-4000-8000-000000000301",
    name: "Учебный набор: следующий проект",
  });
  const membership = await fetch(
    `${api}/product-waitlists/${seeded.productId}/membership`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  expect(membership.status).toBe(200);
  expect(await membership.json()).toEqual({
    intakeId: "97000000-0000-4000-8000-000000000301",
    name: "Учебный набор: следующий проект",
    active: true,
  });
  const payments = await fetch(`${api}/billing/admin`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ownerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operationId: "97000000-0000-4000-8000-000000000601",
      operation: "payments.list",
      productId: seeded.productId,
    }),
  });
  expect(payments.status).toBe(200);
  expect(await payments.json()).toMatchObject({
    result: {
      outcome: "payments",
      items: [
        {
          amountKopecks: 1_490_000,
          state: "pending",
          access: "awaiting_payment",
          snapshot: { product: { name: "Учебный курс: от идеи к выпуску" } },
        },
      ],
    },
  });
});
afterAll(async () => {
  reportLearningStage("cleanup", "start");
  const failures: unknown[] = [];
  for (const { stage, run } of cleanups.toReversed()) {
    reportLearningStage(stage, "start");
    try {
      await run();
    } catch (error) {
      reportLearningStage(stage, "failed");
      failures.push(error);
    } finally {
      reportLearningStage(stage, "end");
    }
  }
  reportLearningStage("cleanup", "end");
  if (failures.length > 0)
    throw new AggregateError(failures, "Learning scenario cleanup failed");
});

test("the isolated legacy Material accepts a title-only save with its seeded image and file intact", async () => {
  const legacy = await database.run(() =>
    seedLocalDevelopment(database.prisma),
  );
  await seedLegacyMaterialAssets({
    api,
    databaseName: new URL(database.url).pathname.slice(1),
    ownerToken,
  });
  const response = await fetch(
    `${api}/authoring/materials/${legacy.materialId}`,
    {
      headers: { authorization: `Bearer ${ownerToken}` },
    },
  );
  expect(response.status).toBe(200);
  const current = materialSchema.parse(await response.json());
  const nodes = z
    .object({ content: z.array(z.record(z.string(), z.unknown())) })
    .parse(current.body.doc).content;
  const assets = nodes.filter(
    (node) => node["type"] === "assetImage" || node["type"] === "assetFile",
  );
  expect(assets).toHaveLength(2);
  expect(assets.map((node) => node["type"])).toEqual([
    "assetImage",
    "assetFile",
  ]);
  const image = z
    .object({ assetId: z.uuid(), alt: z.string(), caption: z.string() })
    .parse(assets[0]?.["attrs"]);
  const file = z
    .object({ assetId: z.uuid(), label: z.string() })
    .parse(assets[1]?.["attrs"]);
  expect(image.alt).toBe("Путь Material от PostgreSQL до Reader");
  expect(image.caption).toBe("Один vertical production path");
  expect(file.label).toBe("Reader verification checklist");
  expect(image.assetId).not.toBe("72000000-0000-4000-8000-000000000030");
  expect(file.assetId).not.toBe("72000000-0000-4000-8000-000000000031");
  const fileAddress = `${api}/materials/${legacy.materialId}/assets/${file.assetId}?contentVersion=${current.contentVersion}`;
  const anonymousDownload = await fetch(fileAddress);
  expect(anonymousDownload.status).toBe(404);
  // RustFS checks the signed URL against its real clock; no domain calendar value is asserted here.
  vi.setSystemTime(vi.getRealSystemTime());
  try {
    const storageOwnerToken = await identity.sign(scenarioRoles.owner.subject);
    const download = await fetch(fileAddress, {
      headers: { authorization: `Bearer ${storageOwnerToken}` },
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(
      "Проверка Reader: открыть материал, прочитать текст, скачать файл.\n",
    );
  } finally {
    vi.setSystemTime(fixedTestInstant());
  }
  const diagram = await fetch(
    `${api}/materials/${legacy.materialId}/assets/${image.assetId}/images/640?contentVersion=${current.contentVersion}`,
    { headers: { authorization: `Bearer ${ownerToken}` } },
  );
  expect(diagram.status).toBe(200);
  expect(diagram.headers.get("content-type")).toContain("image/svg+xml");
  expect(await diagram.text()).toContain("PostgreSQL");
  await seedLegacyMaterialAssets({
    api,
    databaseName: new URL(database.url).pathname.slice(1),
    ownerToken,
  });
  const repeated = await fetch(
    `${api}/authoring/materials/${legacy.materialId}`,
    { headers: { authorization: `Bearer ${ownerToken}` } },
  );
  const stable = materialSchema.parse(await repeated.json());
  expect(stable.contentVersion).toBe(current.contentVersion);
  expect(stable.body).toEqual(current.body);
  const { productMemberships, slug: _slug, ...metadata } = current.metadata;
  const saved = await fetch(`${api}/authoring/materials/${legacy.materialId}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${ownerToken}`,
      "content-type": "application/json",
      "idempotency-key": "isolated-legacy-title-only-save",
    },
    body: JSON.stringify({
      expectedContentVersion: current.contentVersion,
      publicationState: current.publicationState,
      primaryVideoId: current.primaryVideoId,
      inFeed: current.inFeed,
      notifyTelegram: false,
      metadata: {
        ...metadata,
        title: "Как устроен Inside Platform: учебная правка",
        productIds: productMemberships.map(({ productId }) => productId),
      },
      body: current.body,
    }),
  });
  expect(saved.status).toBe(200);
  const reloaded = await fetch(
    `${api}/authoring/materials/${legacy.materialId}`,
    {
      headers: { authorization: `Bearer ${ownerToken}` },
    },
  );
  expect(reloaded.status).toBe(200);
  const result = materialSchema.parse(await reloaded.json());
  expect(result.metadata.title).toBe(
    "Как устроен Inside Platform: учебная правка",
  );
  expect(result.body).toEqual(current.body);
  expect(result.publicationState).toBe("published");
});

test("the isolated seed publishes populated chapters, an extra reference and an empty upcoming chapter through the real API", async () => {
  const response = await fetch(`${api}/library/products/synthetic-learning`);
  expect(response.status).toBe(200);
  const result = z
    .object({
      items: z.array(
        z.object({ materialId: z.string(), title: z.string() }).loose(),
      ),
      chapters: z.array(
        z
          .object({
            name: z.string(),
            materialIds: z.array(z.string()),
            supplementaryMaterialIds: z.array(z.string()).optional(),
          })
          .loose(),
      ),
    })
    .loose()
    .parse(await response.json());
  const title = new Map(
    result.items.map((item) => [item.materialId, item.title]),
  );
  expect(
    result.chapters.map((chapter) => ({
      name: chapter.name,
      lessons: chapter.materialIds.map((id) => title.get(id)),
      supplementary:
        chapter.supplementaryMaterialIds?.map((id) => title.get(id)) ?? [],
    })),
  ).toEqual([
    {
      name: "Начало учебного проекта",
      lessons: [
        "Учебный пример: первый шаг",
        "Учебный пример: работа над проектом",
      ],
      supplementary: ["Учебный пример: памятка"],
    },
    {
      name: "Выпуск учебного проекта",
      lessons: ["Учебный пример: проверка выпуска"],
      supplementary: [],
    },
    { name: "Следующая учебная глава", lessons: [], supplementary: [] },
  ]);
});

test("the holder has a completed lesson, a started lesson and a bookmark while a learner has no ProductAccess", async () => {
  const catalogue = z
    .object({
      items: z.array(
        z
          .object({
            materialId: z.string(),
            title: z.string(),
            slug: z.string(),
            access: z.enum(["free", "closed"]),
          })
          .loose(),
      ),
    })
    .loose()
    .parse(
      await (await fetch(`${api}/library/products/synthetic-learning`)).json(),
    );
  const names = new Map(
    catalogue.items.map((item) => [item.materialId, item.title]),
  );
  const states = await fetch(`${api}/reading-activity/materials/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${holderToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      materialIds: catalogue.items.map((item) => item.materialId),
    }),
  });
  expect(states.status).toBe(200);
  const parsed = z
    .array(
      z
        .object({
          materialId: z.string(),
          isRead: z.boolean(),
          openedParts: z.number().nullable(),
        })
        .loose(),
    )
    .parse(await states.json());
  expect(
    parsed
      .filter((item) => item.isRead)
      .map((item) => names.get(item.materialId)),
  ).toEqual(["Учебный пример: первый шаг"]);
  expect(
    parsed
      .filter((item) => item.openedParts !== null)
      .map((item) => ({
        title: names.get(item.materialId),
        openedParts: item.openedParts,
      })),
  ).toEqual([{ title: "Учебный пример: работа над проектом", openedParts: 1 }]);
  const bookmarks = await fetch(`${api}/bookmarks/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${holderToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ first: 12 }),
  });
  expect(bookmarks.status).toBe(200);
  expect(await bookmarks.json()).toMatchObject({
    items: [{ title: "Учебный пример: работа над проектом" }],
    nextCursor: null,
  });
  const paid = catalogue.items.find(
    (item) => item.title === "Учебный пример: работа над проектом",
  );
  if (paid === undefined) throw new Error("Expected paid learning lesson");
  const learnerToken = await identity.sign(scenarioRoles.learner.subject, {
    inside_verified_email: "light-learner@inside.test",
  });
  const account = await fetch(`${api}/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${learnerToken}` },
  });
  expect(account.status).toBe(201);
  const denied = await fetch(`${api}/materials/${paid.slug}`, {
    headers: { authorization: `Bearer ${learnerToken}` },
  });
  expect(denied.status).toBe(200);
  const teaser: unknown = await denied.json();
  expect(teaser).toMatchObject({
    kind: "teaser",
    access: { availability: "locked" },
  });
  expect(teaser).not.toHaveProperty("body");
  expect(JSON.stringify(teaser)).not.toContain(
    "Покажи результат учебного шага",
  );
  const allowed = await fetch(`${api}/materials/${paid.slug}`, {
    headers: { authorization: `Bearer ${holderToken}` },
  });
  expect(allowed.status).toBe(200);
  expect(await allowed.text()).toContain("Покажи результат учебного шага");
});

test("the Product dictionary names the term introduced in its readable lesson", async () => {
  const response = await fetch(
    `${api}/library/products/synthetic-learning/glossary`,
    { headers: { authorization: `Bearer ${holderToken}` } },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    terms: [
      {
        id: "synthetic-result",
        title: "Учебный результат",
        lesson: { title: "Учебный пример: первый шаг" },
      },
    ],
  });
});

test("the holder reads the current Task Version, its submission and AuthorFeedback separately from an outdated submission", async () => {
  const page = await fetch(
    `${api}/library/products/synthetic-learning/tasks/synthetic-project`,
    { headers: { authorization: `Bearer ${holderToken}` } },
  );
  expect(page.status).toBe(200);
  expect(await page.json()).toMatchObject({
    access: "open",
    task: { version: 2, title: "Учебный пример: покажи результат" },
  });
  const response = await fetch(
    `${api}/accounts/current/product-tasks/synthetic-project/submissions`,
    { headers: { authorization: `Bearer ${holderToken}` } },
  );
  expect(response.status).toBe(200);
  const history = z
    .object({
      currentVersion: z.number(),
      submissions: z.array(
        z
          .object({
            taskVersion: z.number(),
            note: z.string(),
            authorFeedback: z
              .object({
                comment: z.string().nullable(),
                reviewedAt: z.string().nullable(),
              })
              .nullable(),
          })
          .loose(),
      ),
    })
    .loose()
    .parse(await response.json());
  expect(history.currentVersion).toBe(2);
  expect(history.submissions.map((item) => item.taskVersion).sort()).toEqual([
    1, 2,
  ]);
  expect(
    history.submissions.find((item) => item.taskVersion === 2),
  ).toMatchObject({
    note: "Учебный результат проверен по инструкции.",
    authorFeedback: {
      comment: "Учебный результат понятен. Добавь пример входных данных.",
    },
  });
  expect(
    typeof history.submissions.find((item) => item.taskVersion === 2)
      ?.authorFeedback?.reviewedAt,
  ).toBe("string");
  expect(
    history.submissions.find((item) => item.taskVersion === 1),
  ).toMatchObject({
    note: "Первая учебная попытка до изменения задания.",
    authorFeedback: null,
  });
});

test("the extra lesson links to the current synthetic artifact file without a pinned version", async () => {
  const catalogue = z
    .object({
      items: z.array(z.object({ title: z.string(), slug: z.string() })),
    })
    .parse(
      await (await fetch(`${api}/library/products/synthetic-learning`)).json(),
    );
  const reference = catalogue.items.find(
    ({ title }) => title === "Учебный пример: памятка",
  );
  if (reference === undefined) throw new Error("Expected supplementary lesson");
  const response = await fetch(`${api}/materials/${reference.slug}`, {
    headers: { authorization: `Bearer ${holderToken}` },
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("Скачать шаблон результата (.txt)");
  expect(body).toContain(
    `/api/products/${seeded.productId}/artifact-sources/synthetic-scenarios%3Aresult/file`,
  );
  expect(body).not.toContain("artifact:result");
  expect(body).not.toContain("?version=");
});

test("the populated product offers a real downloadable synthetic artifact", async () => {
  const response = await fetch(
    `${api}/products/${seeded.productId}/artifacts`,
    { headers: { authorization: `Bearer ${holderToken}` } },
  );
  expect(response.status).toBe(200);
  const result = z
    .object({
      artifacts: z.array(
        z
          .object({
            artifactId: z.string(),
            title: z.string(),
            availability: z.string(),
            content: z
              .object({ kind: z.string(), filename: z.string() })
              .loose(),
          })
          .loose(),
      ),
    })
    .parse(await response.json());
  expect(result.artifacts).toMatchObject([
    {
      title: "Учебный пример: шаблон результата",
      availability: "available",
      content: { kind: "file", filename: "synthetic-result.txt" },
    },
  ]);
  const artifact = result.artifacts[0];
  expect(artifact).toBeDefined();
  const download = await fetch(
    `${api}/products/${seeded.productId}/artifacts/${artifact?.artifactId}/file?version=1`,
    { headers: { authorization: `Bearer ${holderToken}` } },
  );
  expect(download.status).toBe(200);
  expect(await download.text()).toBe(
    "Учебный результат: первый шаг и повторяемая проверка.\n",
  );
});

test.each([
  {
    api: "https://example.invalid",
    databaseName: "inside_test_" + "a".repeat(32),
    message: "owned loopback API",
  },
  {
    api: "http://127.0.0.1:9",
    databaseName: "inside",
    message: "isolated instance database",
  },
  {
    api: "http://127.0.0.1:9",
    databaseName: "inside_checks",
    message: "isolated instance database",
  },
  {
    api: "http://127.0.0.1:9/production",
    databaseName: "inside_light_0123456789",
    message: "owned loopback API",
  },
])(
  "the seed refuses a non-isolated target before its first write: $api $databaseName",
  async ({ api: target, databaseName, message }) => {
    await expect(
      seedReadingFeedScenario({
        api: target,
        databaseName,
        ownerToken: "unused",
      }),
    ).rejects.toThrow(message);
    await expect(
      seedLearningScenario({
        api: target,
        databaseName,
        ownerToken: "unused",
        holderToken: "unused",
      }),
    ).rejects.toThrow(message);
    await expect(
      seedCommerceScenario({
        api: target,
        databaseName,
        ownerToken: "unused",
        buyerToken: "unused",
        productId: seeded.productId,
        createIntake: () =>
          createIsolatedProductIntake({
            databaseUrl: database.url,
            productId: seeded.productId,
          }),
        completeTelegramLink: async (deepLink) => {
          const response = await fetch(
            new URL(
              "/__scenario/complete",
              telegram.environment.TELEGRAM_LINKING_ENDPOINT,
            ),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${telegram.environment.TELEGRAM_LINKING_SECRET}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ deepLink }),
            },
          );
          expect(response.status).toBe(200);
        },
      }),
    ).rejects.toThrow(message);
    await expect(
      seedLegacyMaterialAssets({
        api: target,
        databaseName,
        ownerToken: "unused",
      }),
    ).rejects.toThrow(message);
  },
);
