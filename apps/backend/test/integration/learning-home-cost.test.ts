import { createLearningStartedRead } from "../../src/modules/reading-activity/shared/learning-started.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  assembleAccountRights,
  assembleAccessGrants,
} from "../../src/modules/account-rights/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
} from "../../src/modules/content-access/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
  PublishedMaterialSelection,
  PublishedSeriesComposition,
} from "../../src/modules/materials/index.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { PersonalHome } from "../../src/modules/reading-activity/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";
import {
  registerFixedClock,
  fixedTestInstant,
} from "../support/fixed-clock.js";

registerFixedClock();
const id = (group: number, n: number) =>
  `${String(group).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(800, 1);
const aliasProduct = "00000abc-0000-4000-8000-000000000001";
const configurations = [
  { name: "single", visits: 1, next: 1, examined: 1 },
  { name: "early", visits: 10, next: 1, examined: 1 },
  { name: "last", visits: 10, next: 10, examined: 10 },
  { name: "all-read", visits: 10, next: 0, examined: 10 },
  { name: "bounded", visits: 12, next: 11, examined: 10 },
  { name: "empty", visits: 0, next: 0, examined: 0 },
] as const;
let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let observer: ReturnType<typeof createQueryEventClient>;
let fixture: Awaited<ReturnType<typeof prepare>>;
async function prepare() {
  const now = new Date(fixedTestInstant());
  const providerFind = vi.fn(({ id }: { id: string }) =>
    Promise.resolve({
      id,
      projectId: "members",
      title: "Current video",
      status: "done" as const,
      durationSeconds: 600,
      embedLocator: `https://kinescope.io/embed/${id}`,
    }),
  );
  const unused = () =>
    Promise.reject(new Error("Unexpected provider request during Home read"));
  const videoOwner = assembleVideos({
    prisma: observer.prisma,
    canManage: () => Promise.resolve(true),
    projects: { free: "public", closed: "members" },
    provider: { initUpload: unused, delete: unused, find: providerFind },
    clock: () => now,
  });
  const durationRead = vi.fn(videoOwner.loadReadyDurations.bind(videoOwner));
  const progressRead = vi.fn(videoOwner.loadProgressMany.bind(videoOwner));
  const videoFactsRead = vi.fn(videoOwner.loadAccessFacts.bind(videoOwner));
  const videos = {
    ...videoOwner,
    loadReadyDurations: durationRead,
    loadProgressMany: progressRead,
    loadAccessFacts: videoFactsRead,
  };
  const baseMaterials = assembleMaterials({
    prisma: observer.prisma,
    authorPolicy: { canManage: () => true },
    videos,
  });
  const resourceOwner = assembleMaterialResourceFacts(
    baseMaterials.materialContent,
  );
  const materialFactsRead = vi.fn(resourceOwner.findMany.bind(resourceOwner));
  const permissions = assembleCurrentAccountPermissions(
    assembleAccounts({
      prisma: observer.prisma,
      emailFingerprintKey: "synthetic-home-cost-fingerprint-key-0000000",
    }),
  );
  const permissionRead = vi.fn(
    permissions.hasMaterialsManage.bind(permissions),
  );
  const rights = assembleAccountRights({
    prisma: observer.prisma,
    clock: () => now,
  });
  if (rights.resolveManyForAccess === undefined)
    throw new Error("Owning AccountRights batch unavailable");
  const rightsMany = vi.fn(rights.resolveManyForAccess.bind(rights));
  const rightsOne = vi.fn(rights.resolveForAccess.bind(rights));
  const accessOwner = assembleContentAccess({
    materialResourceFacts: { ...resourceOwner, findMany: materialFactsRead },
    videoResourceFacts: assembleVideoResourceFacts(videos),
    accountPermissions: { hasMaterialsManage: permissionRead },
    accountRights: {
      ...rights,
      resolveManyForAccess: rightsMany,
      resolveForAccess: rightsOne,
    },
    clock: () => now,
  });
  const availabilityRead = vi.fn(
    accessOwner.checkAvailabilityMany.bind(accessOwner),
  );
  const productAccessRead = vi.fn(
    accessOwner.checkProductAccess.bind(accessOwner),
  );
  const contentAccess = {
    ...accessOwner,
    checkAvailabilityMany: availabilityRead,
    checkProductAccess: productAccessRead,
  };
  const materials = assembleMaterials({
    prisma: observer.prisma,
    authorPolicy: { canManage: () => true },
    videos,
    contentAccess,
  });
  const selectionOwner = new PublishedMaterialSelection(observer.prisma);
  const selectionRead = vi.fn(selectionOwner.read.bind(selectionOwner));
  const compositionOwner = new PublishedSeriesComposition(observer.prisma);
  const compositionRead = vi.fn(compositionOwner.read.bind(compositionOwner));
  const discoveryRead = vi.fn(
    materials.publishedMaterialReader.discoverProjections.bind(
      materials.publishedMaterialReader,
    ),
  );
  const home = new PersonalHome({
    prisma: observer.prisma,
    materialContent: materials.materialContent,
    contentAccess,
    videos,
    reader: { discoverProjections: discoveryRead },
    selection: { read: selectionRead },
    composition: { read: compositionRead },
  });
  const cases = [
    ...configurations.map((configuration, caseIndex) => ({
      configuration,
      caseIndex,
    })),
    ...[
      { name: "standalone", visits: 1, next: 1, examined: 1 },
      { name: "other-account", visits: 1, next: 1, examined: 1 },
      { name: "positive", visits: 1, next: 1, examined: 1 },
      { name: "revoked", visits: 10, next: 10, examined: 10 },
    ].map((configuration, index) => ({
      configuration,
      caseIndex: 100 + index,
    })),
  ];
  await database.prisma.account.createMany({
    data: [actor, ...cases.map(({ caseIndex }) => id(800, caseIndex + 2))].map(
      (account) => ({
        id: account,
        logtoIssuer: "https://home-cost.test",
        logtoSubject: account,
      }),
    ),
  });
  await database.prisma.topic.create({
    data: { id: id(801, 1), name: "Learning Home", slug: "home-cost" },
  });
  await database.prisma.product.createMany({
    data: Array.from({ length: 12 }, (_, index) => ({
      id: id(802, index + 1),
      name: `Route ${String(index + 1).padStart(2, "0")}`,
      slug: `home-cost-${String(index + 1)}`,
    })),
  });
  await database.prisma.product.create({
    data: { id: aliasProduct, name: "Alias route", slug: "home-cost-alias" },
  });
  await database.prisma.productLearningStarted.create({
    data: { accountId: id(800, 104), productId: aliasProduct, startedAt: now },
  });
  const items: {
    materialId: string;
    contentVersion: number;
    videoId: string;
  }[] = [];
  for (let index = 1; index <= 12; index++) {
    const metadata = {
      title: `Home video ${String(index)}`,
      summary: "Current ordered video",
      topicId: id(801, 1),
      formatId: "video",
      access: "closed" as const,
      tagIds: [],
      difficulty: null,
      outcomes: [],
      seriesIds: [id(802, index)],
    };
    const body = representativeDocument("Current learning route");
    const draft = await materials.authoring.createDraft({
      actor,
      idempotencyKey: id(803, index),
      metadata,
      body,
    });
    if (!draft.ok) throw new Error(draft.error.code);
    const video = await videos.attachExisting({
      actor,
      materialId: draft.value.materialId,
      access: "closed",
      providerVideoId: id(804, index),
    });
    if (!video.ok) throw new Error(video.error.code);
    const saved = await materials.authoring.saveMaterial({
      actor,
      materialId: draft.value.materialId,
      expectedContentVersion: draft.value.contentVersion,
      idempotencyKey: id(805, index),
      metadata,
      body,
      primaryVideoId: video.value.videoId,
      publicationState: "published",
    });
    if (!saved.ok) throw new Error(saved.error.code);
    items.push({
      materialId: saved.value.materialId,
      contentVersion: saved.value.contentVersion,
      videoId: video.value.videoId,
    });
  }
  await database.prisma.accountPermission.create({
    data: { accountId: actor, permission: "billing:manage" },
  });
  for (const { caseIndex, configuration } of cases) {
    const account = id(800, caseIndex + 2);
    await database.prisma.accessGrant.create({
      data: {
        id: id(806, caseIndex + 1),
        accountId: account,
        source: "manual",
        sourceRef: `home-cost-${String(caseIndex)}`,
        capabilities: ["materials"],
        coverage: {
          productIds: Array.from({ length: 12 }, (_, index) =>
            id(802, index + 1),
          ),
          materialIds: [],
        },
        startsAt: new Date(now.getTime() - 60_000),
        validUntil: null,
        revision: 1,
        reason: "Measured Home access",
      },
    });
    await database.prisma.readingMaterialVisit.createMany({
      data: items.slice(0, configuration.visits).map((item, index) => ({
        accountId: account,
        materialId: item.materialId,
        firstOpenedAt: new Date(now.getTime() - 12_000),
        lastOpenedAt: new Date(now.getTime() - index * 1000),
      })),
    });
    await database.prisma.readingMaterialState.createMany({
      data: items.slice(0, configuration.visits).map((item, index) => ({
        accountId: account,
        materialId: item.materialId,
        isRead: index + 1 !== configuration.next,
        readAt: index + 1 !== configuration.next ? now : null,
        version: 1,
        updatedAt: now,
      })),
    });
    for (const item of items.slice(0, configuration.visits)) {
      const saved = await videos.saveProgress({
        accountId: account,
        videoId: item.videoId,
        positionSeconds: 60,
        durationSeconds: 600,
      });
      if (!saved.ok) throw new Error(saved.error.code);
    }
  }
  await database.prisma.productLearningStarted.createMany({
    data: [1, 12].map((product) => ({
      accountId: id(800, 104),
      productId: id(802, product),
      startedAt: now,
    })),
  });
  const writers = assembleAccessGrants({
    prisma: database.prisma,
    accounts: assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "synthetic-home-cost-fingerprint-key-0000000",
    }),
    recipientLinks: new TelegramAccountLinks(database.prisma),
    clock: () => now,
  });
  const counters = {
    selectionRead,
    discoveryRead,
    compositionRead,
    availabilityRead,
    productAccessRead,
    permissionRead,
    rightsMany,
    rightsOne,
    materialFactsRead,
    videoFactsRead,
    durationRead,
    progressRead,
    providerFind,
  };
  return {
    home,
    items,
    counters,
    writers,
    reader: materials.publishedMaterialReader,
    reset() {
      for (const counter of Object.values(counters)) counter.mockClear();
    },
  };
}
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  observer = createQueryEventClient(database.url);
  fixture = await prepare();
});
afterAll(async () => {
  await observer.prisma.$disconnect();
  await database.dispose();
});
for (const [caseIndex, configuration] of configurations.entries()) {
  test(`measures bounded continuation ${configuration.name} without defeating early exit`, async () => {
    fixture.reset();
    const account = id(800, caseIndex + 2);
    const measured = await observer.measure(() =>
      fixture.home.getLearning(account),
    );
    expect(measured.result.ok).toBe(true);
    if (!measured.result.ok) throw new Error(measured.result.error.code);
    const selected =
      configuration.next > 0 && configuration.next <= 10
        ? id(802, configuration.next)
        : undefined;
    expect(measured.result.value.series?.collection.id).toBe(selected);
    expect(fixture.counters.discoveryRead).toHaveBeenCalledTimes(
      configuration.examined,
    );
    expect(fixture.counters.compositionRead).toHaveBeenCalledTimes(
      configuration.examined,
    );
    expect(fixture.counters.selectionRead).toHaveBeenCalledTimes(
      configuration.visits === 0 ? 0 : 1,
    );
    if (configuration.visits > 0)
      expect(fixture.counters.selectionRead.mock.calls[0]?.[0]).toHaveLength(
        configuration.visits,
      );
    expect(fixture.counters.rightsOne).not.toHaveBeenCalled();
    expect(fixture.counters.providerFind).not.toHaveBeenCalled();
    if (selected !== undefined) {
      const item = fixture.items[configuration.next - 1];
      expect(measured.result.value.video).toMatchObject({
        material: {
          materialId: item?.materialId,
          contentVersion: item?.contentVersion,
        },
        resume: { kind: "position", positionSeconds: 60 },
      });
      expect(measured.result.value.series?.continuation?.resume).toEqual({
        kind: "position",
        positionSeconds: 60,
      });
    }
    process.stdout.write(
      `${JSON.stringify({ record: "BC-3", fixture: configuration.name, candidateVisits: configuration.visits, examinedSeries: configuration.examined, physicalSql: measured.statements.length, startedSql: measured.statements.filter((sql) => sql.includes("product_learning_started")).length, ownerCalls: Object.fromEntries(Object.entries(fixture.counters).map(([name, counter]) => [name, counter.mock.calls.length])), availabilityBatchSizes: fixture.counters.availabilityRead.mock.calls.map(([input]) => input.operations.length), resourceBatchSizes: fixture.counters.materialFactsRead.mock.calls.map(([ids]) => ids.length), progressBatchSizes: fixture.counters.progressRead.mock.calls.map(([input]) => input.videoIds.length), durationBatchSizes: fixture.counters.durationRead.mock.calls.map(([ids]) => ids.length), providerRequests: 0, wireHttpRequests: 0 })}\n`,
    );
    expect(
      measured.statements.filter((sql) =>
        sql.includes("product_learning_started"),
      ),
    ).toHaveLength(configuration.examined === 0 ? 0 : 1);
  });
}

test("standalone reads remain fresh, started status is Account scoped and is not inferred from visits", async () => {
  const account = id(800, 102);
  expect(await fixture.home.getLearning(account)).toMatchObject({
    ok: true,
    value: { series: { started: false } },
  });
  const before = await fixture.home.getSeries(account, "home-cost-1");
  expect(before).toMatchObject({ ok: true, value: { started: false } });
  const item = fixture.items[0];
  if (item === undefined) throw new Error("Missing material");
  const opened = await fixture.home.recordOpen({
    accountId: account,
    materialId: item.materialId,
    contentVersion: item.contentVersion,
    commandId: id(807, 1),
  });
  expect(opened.ok).toBe(true);
  expect(await fixture.home.getSeries(account, "home-cost-1")).toMatchObject({
    ok: true,
    value: { started: true },
  });
  expect(await fixture.home.getLearning(account)).toMatchObject({
    ok: true,
    value: { series: { started: true } },
  });
  expect(await fixture.home.getLearning(id(800, 103))).toMatchObject({
    ok: true,
    value: { series: { started: false } },
  });
  expect(await fixture.home.getLearning(id(800, 104))).toMatchObject({
    ok: true,
    value: { series: { started: true } },
  });
});
test("later series retain fresh authorization after a locked grant revocation", async () => {
  const account = id(800, 105);
  fixture.reset();
  const original = fixture.reader.discoverProjections.bind(fixture.reader);
  fixture.counters.discoveryRead.mockImplementation(async (input) => {
    if (fixture.counters.discoveryRead.mock.calls.length === 2) {
      expect(
        await fixture.writers.changeGrant(actor, {
          operationId: id(807, 2),
          action: "revoke",
          grantRef: id(806, 104),
          expectedRevision: 1,
          reason: "Controlled revoke between series",
        }),
      ).toMatchObject({ ok: true, revision: 2 });
    }
    return original(input);
  });
  try {
    const result = await fixture.home.getLearning(account);
    expect(result).toMatchObject({ ok: true, value: { series: null } });
    expect(fixture.counters.discoveryRead).toHaveBeenCalledTimes(10);
    expect(fixture.counters.rightsMany.mock.calls.length).toBeGreaterThan(2);
    expect(await fixture.home.getLearning(account)).toEqual({
      ok: true,
      value: { video: null, series: null },
    });
  } finally {
    fixture.counters.discoveryRead.mockImplementation(original);
  }
});

test("bounded started facts normalize UUID aliases and fall back for another Account or unknown Product", async () => {
  const account = id(800, 104);
  const readStarted = createLearningStartedRead(observer.prisma, account, [
    aliasProduct.toUpperCase(),
  ]);
  const measured = await observer.measure(async () => {
    expect(await readStarted(account, aliasProduct.toUpperCase())).toBe(true);
    expect(await readStarted(account, aliasProduct)).toBe(true);
    expect(await readStarted(account, id(802, 12))).toBe(true);
    expect(await readStarted(id(800, 103), aliasProduct)).toBe(false);
  });
  expect(
    measured.statements.filter((sql) =>
      sql.includes("product_learning_started"),
    ),
  ).toHaveLength(3);
  expect(() =>
    createLearningStartedRead(
      observer.prisma,
      account,
      Array.from({ length: 11 }, (_, i) => id(802, i + 1)),
    ),
  ).toThrow("series bound");
});
test("a failed started read remains unavailable and the next Home operation retries fresh", async () => {
  const injection = vi
    .spyOn(observer.prisma.productLearningStarted, "findMany")
    .mockRejectedValueOnce(new Error("Controlled started facts failure"));
  try {
    expect(await fixture.home.getLearning(id(800, 104))).toEqual({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
    expect(await fixture.home.getLearning(id(800, 104))).toMatchObject({
      ok: true,
      value: { series: { started: true } },
    });
  } finally {
    injection.mockRestore();
  }
});
