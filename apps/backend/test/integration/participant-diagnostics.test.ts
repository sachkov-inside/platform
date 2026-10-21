import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  ParticipantDiagnostics,
  registerParticipantDiagnosticsTool,
} from "../../src/entrypoints/mcp/participant-diagnostics.js";
import {
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import {
  Bookmarks,
  BookmarkActivityFacts,
} from "../../src/modules/bookmarks/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
  ProductDirectory,
  PublishedMaterialSelection,
  PublishedSeriesComposition,
} from "../../src/modules/materials/index.js";
import {
  ReadingActivity,
  ReadingActivityFacts,
} from "../../src/modules/reading-activity/index.js";
import {
  assembleLearningTasks,
  TaskSubmissionFacts,
} from "../../src/modules/product-tasks/index.js";
import { assembleApplySourceTask } from "../../src/modules/product-tasks/features/import-product-task/import-product-task.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { activityTestClock } from "./setup/activity-test-clock.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();
let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

it("counts overlapping confirmed commands once across Moscow midnight through delegated MCP and excludes the right boundary", async () => {
  const owner = randomUUID(),
    first = randomUUID(),
    second = randomUUID(),
    excluded = randomUUID();
  for (const id of [owner, first, second, excluded])
    await database.prisma.account.create({
      data: { id, logtoIssuer: "https://participant.test", logtoSubject: id },
    });
  await database.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "participant-diagnostics-test-fingerprint-key-v1",
  });
  const authorPolicy = { canManage: (actor: string) => actor === owner };
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy,
  });
  const directory = new ProductDirectory(database.prisma);
  const contentAccess = assembleContentAccess({
    materialResourceFacts: assembleMaterialResourceFacts(
      materials.materialContent,
    ),
    productTaskResourceFacts: assembleProductTaskResourceFacts(database.prisma),
    accountPermissions: {
      hasMaterialsManage: (id) => Promise.resolve(id === owner),
    },
    accountRights: assembleAccountRights({ prisma: database.prisma }),
  });
  const topic = randomUUID(),
    product = randomUUID(),
    chapter = randomUUID();
  await database.prisma.topic.create({
    data: { id: topic, slug: "participants", name: "Participants" },
  });
  await database.prisma.product.create({
    data: { id: product, slug: "participants", name: "Participants" },
  });
  await database.prisma.productChapter.create({
    data: { id: chapter, productId: product, name: "Chapter", ordinal: 1 },
  });
  const draft = await materials.authoring.createDraft({
    actor: owner,
    idempotencyKey: randomUUID(),
    metadata: {
      title: "Activity",
      summary: "Confirmed commands",
      topicId: topic,
      formatId: "note",
      access: "free",
      tagIds: [],
      difficulty: null,
      outcomes: [],
      seriesIds: [],
    },
    body: representativeDocument("Activity"),
  });
  if (!draft.ok) throw new Error(draft.error.code);
  const published = await materials.authoring.transitionPublication({
    actor: owner,
    idempotencyKey: randomUUID(),
    materialId: draft.value.materialId,
    expectedContentVersion: draft.value.contentVersion,
    publicationState: "published",
  });
  if (!published.ok) throw new Error(published.error.code);
  const materialId = published.value.materialId;
  const code = "participant-task";
  const imported = await assembleApplySourceTask({
    prisma: database.prisma,
    directory,
    authorPolicy,
  })(
    {
      sourceId: `inside-content:${code}`,
      code,
      productId: product,
      chapterId: chapter,
      position: 1,
      title: "Activity task",
      access: "free",
      relatedMaterialSourceIds: [],
      afterMaterialSourceId: null,
      publicationState: "published",
      expectedRevision: null,
      definition: {
        schemaVersion: 1,
        situation: "Confirm work",
        result: ["A submitted result"],
        freedom: "Choose a tool",
        criteria: [
          {
            id: "result",
            level: "required",
            requirement: "Submit work",
            acceptableEvidence: ["Submission"],
          },
        ],
      },
      provenance: {
        repository: "sachkov-inside/inside-content",
        commit: "c".repeat(40),
        path: "course/tasks/participant-task.yaml",
      },
    },
    { actor: owner, idempotencyKey: randomUUID() },
  );
  if (!imported.ok) throw new Error(imported.error.code);
  const reading = new ReadingActivity({
    prisma: database.prisma,
    contentAccess,
    materialContent: materials.materialContent,
    composition: new PublishedSeriesComposition(database.prisma),
  });
  const bookmarks = new Bookmarks({
    prisma: database.prisma,
    contentAccess,
    selection: new PublishedMaterialSelection(database.prisma),
    videos: {
      loadReadyDurations: () => Promise.reject(new Error("not called")),
    },
  });
  const tasks = assembleLearningTasks({
    prisma: database.prisma,
    directory,
    contentAccess,
    materialReader: materials.publishedMaterialReader,
    submissionsEnabled: true,
  });
  const dbClock = await activityTestClock(database.prisma);
  const moscow = new Date(dbClock.at.getTime() + 3 * 3_600_000);
  const midnight =
    Date.UTC(
      moscow.getUTCFullYear(),
      moscow.getUTCMonth(),
      moscow.getUTCDate(),
    ) -
    3 * 3_600_000;
  const window = {
    from: new Date(midnight - 1).toISOString(),
    to: new Date(midnight + 2).toISOString(),
  };
  vi.setSystemTime(midnight - 1);
  const mark = {
    accountId: first,
    materialId,
    commandId: randomUUID(),
    isRead: true,
    expectedVersion: 0,
  };
  expect(await reading.setReadingState(mark)).toMatchObject({ ok: true });
  expect(await reading.setReadingState(mark)).toMatchObject({ ok: true });
  vi.setSystemTime(midnight);
  expect(
    await bookmarks.addBookmark({ accountId: first, materialId }),
  ).toMatchObject({ ok: true });
  vi.setSystemTime(midnight + 1);
  expect(
    await reading.setReadingState({
      ...mark,
      accountId: second,
      commandId: randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  const submission = {
    subject: { kind: "account" as const, accountId: accountId(first) },
    source: "form" as const,
    submission: {
      code,
      taskVersion: 1,
      submissionKey: randomUUID(),
      note: "Confirmed",
    },
  };
  expect(await tasks.submit(submission)).toMatchObject({ ok: true });
  expect(await tasks.submit(submission)).toMatchObject({ ok: true });
  vi.setSystemTime(midnight + 2);
  expect(
    await bookmarks.addBookmark({ accountId: excluded, materialId }),
  ).toMatchObject({ ok: true });
  const diagnostics = new ParticipantDiagnostics(
    accounts,
    new ReadingActivityFacts(database.prisma),
    new BookmarkActivityFacts(database.prisma),
    new TaskSubmissionFacts(database.prisma),
  );
  const server = new McpServer({ name: "participants-postgres", version: "1" });
  registerParticipantDiagnosticsTool(server, {
    accountId: owner,
    participants: diagnostics,
  });
  const client = new Client({
    name: "participant-postgres-contract",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const response = await client.callTool({
      name: "active_participant_diagnostics",
      arguments: window,
    });
    expect(response).toMatchObject({
      structuredContent: {
        ok: true,
        value: {
          membership: { status: "observed", count: 2, coverage: "partial" },
          sources: [
            { source: "reading", status: "observed" },
            { source: "bookmarks", status: "observed" },
            { source: "submissions", status: "observed" },
          ],
          telegram: { count: null },
          combined: { count: null },
        },
      },
    });
    for (const id of [first, second, excluded])
      expect(JSON.stringify(response)).not.toContain(id);
    const empty = await diagnostics.read(owner, {
      from: new Date(midnight - 2 * 86_400_000).toISOString(),
      to: new Date(midnight - 86_400_000).toISOString(),
    });
    expect(empty).toMatchObject({
      ok: true,
      value: {
        membership: { status: "observed", count: 0, coverage: "partial" },
        telegram: { count: null },
      },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`alter table bookmarks.activity_events rename to unavailable_activity_events`,
    );
    try {
      expect(
        await client.callTool({
          name: "active_participant_diagnostics",
          arguments: window,
        }),
      ).toMatchObject({
        structuredContent: {
          ok: true,
          value: {
            membership: { status: "unknown", count: null },
            sources: [
              { status: "observed" },
              {
                source: "bookmarks",
                status: "unknown",
                error: { code: "source_unavailable" },
              },
              { status: "observed" },
            ],
          },
        },
      });
    } finally {
      await database.prisma.$executeRaw(
        Prisma.sql`alter table bookmarks.unavailable_activity_events rename to activity_events`,
      );
    }
    await database.prisma.accountPermission.delete({
      where: {
        accountId_permission: {
          accountId: owner,
          permission: "platform:admin",
        },
      },
    });
    expect(
      await client.callTool({
        name: "active_participant_diagnostics",
        arguments: window,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
  } finally {
    await client.close();
    await server.close();
  }
});
