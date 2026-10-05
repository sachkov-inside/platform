import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import {
  accountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type ContentAccess,
  type Subject,
} from "../../src/modules/content-access/index.js";
import { assembleGuideTaskResourceFacts } from "../../src/modules/guide-tasks/adapters/content-access/guide-task-resource-facts.js";
import { taskReviewProtocol } from "../../src/modules/guide-tasks/domain/review-protocol.js";
import {
  assembleApplySourceTask,
  assembleValidateSourceTask,
} from "../../src/modules/guide-tasks/features/import-guide-task/import-guide-task.js";
import { SUBMISSIONS_PER_HOUR } from "../../src/modules/guide-tasks/features/submit-task/submit-task.js";
import {
  assembleLearningTasks,
  type LearningTasks,
} from "../../src/modules/guide-tasks/index.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  type AccessCapability,
} from "../../src/modules/membership-entitlements/index.js";
import {
  assembleMaterialResourceFacts,
  assembleMaterials,
  GuideDirectory,
} from "../../src/modules/materials/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { assembleLearnerMcpServer } from "../../src/modules/content-library/index.js";
import { refusingLearnerMcpDependencies } from "../fixtures/learner-mcp.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const definition = {
  schemaVersion: 1 as const,
  situation:
    "Заказчик хочет, чтобы участник оставлял заявку на консультацию и видел её статус.",
  result: [
    "Участник создаёт заявку и видит её статус.",
    "Другой участник не видит чужую заявку.",
  ],
  freedom: "Стек, хранилище и формат документов участник выбирает сам.",
  criteria: [
    {
      id: "request",
      level: "required" as const,
      requirement: "Участник создаёт заявку с темой и описанием.",
      acceptableEvidence: ["Сценарий создания и его наблюдаемый результат."],
    },
    {
      id: "ownership",
      level: "required" as const,
      requirement: "Другой участник не получает чужую заявку.",
      acceptableEvidence: ["Проверка владельца до ответа."],
    },
    {
      id: "deduplication",
      level: "additional" as const,
      requirement: "Повтор запроса не создаёт вторую заявку.",
      acceptableEvidence: ["Наблюдение повтора с одним идентификатором."],
    },
  ],
};
type Definition = typeof definition;

const resultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string() }).loose(),
  }),
]);
const partSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    contextVersion: z.string(),
    contentSha256: z.string(),
    partCount: z.number().int().positive(),
    data: z.string(),
    partSha256: z.string(),
    nextPart: z.number().int().nullable(),
    endOfContext: z.boolean(),
  }),
});

function report(definitionValue: Definition, omit?: string, extra?: string) {
  return {
    criteria: [
      ...definitionValue.criteria
        .filter((criterion) => criterion.id !== omit)
        .map((criterion) => ({
          criterionId: criterion.id,
          status: "confirmed" as const,
          evidence: `README.md описывает «${criterion.id}».`,
          gap: "",
          obtainedByRun: false,
        })),
      ...(extra === undefined
        ? []
        : [
            {
              criterionId: extra,
              status: "not_verified" as const,
              evidence: "",
              gap: "Нет такого критерия.",
              obtainedByRun: false,
            },
          ]),
    ],
  };
}

describe("Guide Tasks: import, versions, access and submissions (#946)", () => {
  let db: TestDatabase;
  const owner = randomUUID();
  const topicId = randomUUID();
  let grants: ReturnType<typeof assembleAccessGrants>;
  let contentAccess: ContentAccess;
  let directory: GuideDirectory;
  let materials: ReturnType<typeof assembleMaterials>;
  let guideId: string;
  let guideSlug: string;
  let chapterId: string;
  let otherChapterId: string;
  let relatedSourceId: string;
  let relatedSlug: string;

  const authorPolicy = { canManage: (actor: string) => actor === owner };
  const importDependencies = () => ({
    prisma: db.prisma,
    directory,
    authorPolicy,
  });
  const learning = (
    submissionsEnabled = true,
    clock?: () => Date,
  ): LearningTasks =>
    assembleLearningTasks({
      prisma: db.prisma,
      directory,
      contentAccess,
      submissionsEnabled,
      ...(clock === undefined ? {} : { clock }),
    });

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    await db.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.test",
        logtoSubject: owner,
      },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "guide-tasks-email-fingerprint-key",
    });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts });
    const membership = assembleMembershipEntitlements({
      prisma: db.prisma,
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma }),
    });
    materials = assembleMaterials({ prisma: db.prisma, authorPolicy });
    directory = new GuideDirectory(db.prisma);
    contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      guideTaskResourceFacts: assembleGuideTaskResourceFacts(db.prisma),
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      membershipEntitlements: membership,
    });
    await db.prisma.topic.create({
      data: { id: topicId, slug: `tasks-${topicId}`, name: "Tasks" },
    });
    guideId = randomUUID();
    guideSlug = `ai-engineering-${guideId}`;
    await db.prisma.guide.create({
      data: { id: guideId, slug: guideSlug, name: "AI Engineering" },
    });
    chapterId = randomUUID();
    otherChapterId = randomUUID();
    await db.prisma.guideChapter.create({
      data: { id: chapterId, guideId, name: "Глава 1", ordinal: 1 },
    });
    const otherGuide = randomUUID();
    await db.prisma.guide.create({
      data: { id: otherGuide, slug: `other-${otherGuide}`, name: "Other" },
    });
    await db.prisma.guideChapter.create({
      data: {
        id: otherChapterId,
        guideId: otherGuide,
        name: "Чужая",
        ordinal: 1,
      },
    });
    const related = await publishedMaterial("free");
    relatedSourceId = related.sourceId;
    relatedSlug = related.slug;
  });
  afterAll(async () => db.dispose());

  async function publishedMaterial(access: "free" | "membership") {
    const id = randomUUID();
    const sourceDescriptor = {
      id: `inside-content:review-${id}`,
      path: `reviews/${id}.md`,
      revision: "a".repeat(64),
      showInFeed: false,
    };
    const reserved = await materials.authoring.reserveSourceMaterial({
      actor: owner,
      source: sourceDescriptor,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const applied = await materials.authoring.applySourceMaterial({
      actor: owner,
      idempotencyKey: `review-${id}`,
      source: sourceDescriptor,
      materialId: reserved.value.materialId,
      expectedContentVersion: reserved.value.contentVersion,
      publicationState: "published",
      primaryVideoId: null,
      metadata: {
        title: `Разбор ${id}`,
        summary: "Разбор задания",
        access,
        topicId,
        formatId: "guide",
        tagIds: [],
        seriesIds: [],
        difficulty: null,
        outcomes: [],
      },
      body: representativeDocument("Разбор"),
    });
    if (!applied.ok) throw new Error(applied.error.code);
    const row = await db.prisma.material.findUniqueOrThrow({
      where: { id: applied.value.materialId },
    });
    if (row.slug === null) throw new Error("Published Material has no slug");
    return { sourceId: sourceDescriptor.id, slug: row.slug };
  }

  async function learner(): Promise<Subject & { kind: "account" }> {
    const id = randomUUID();
    await db.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
    });
    return { kind: "account", accountId: accountId(id) };
  }

  async function grant(
    subject: Subject & { kind: "account" },
    capabilities: AccessCapability[],
  ): Promise<string> {
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "task",
          accountId: subject.accountId,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities,
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            validUntil: null,
            reason: "Guide Task fixture (#946)",
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    const applied = await grants.applyBatch(owner, {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["task"],
    });
    const row = applied.ok ? applied.rows[0]?.result : undefined;
    if (row === undefined || !row.ok || !("grantRef" in row))
      throw new Error("Grant fixture failed");
    return row.grantRef;
  }

  async function revoke(grantRef: string) {
    const revoked = await grants.changeGrant(owner, {
      action: "revoke",
      operationId: randomUUID(),
      grantRef,
      expectedRevision: 1,
      reason: "Guide Task fixture revocation (#946)",
    });
    if (!revoked.ok) throw new Error(revoked.error.code);
  }

  function source(
    overrides: Partial<{
      code: string;
      access: "free" | "membership";
      publicationState: "published" | "unpublished";
      title: string;
      definition: Definition;
      relatedMaterialSourceIds: string[];
      chapterId: string;
      guideId: string;
      position: number;
    }> = {},
  ) {
    const code = overrides.code ?? `task-${randomUUID()}`;
    return {
      sourceId: `inside-content:${code}`,
      code,
      guideId: overrides.guideId ?? guideId,
      chapterId: overrides.chapterId ?? chapterId,
      position: overrides.position ?? 1,
      title: overrides.title ?? "Онбординг заявки",
      access: overrides.access ?? "free",
      definition: overrides.definition ?? definition,
      relatedMaterialSourceIds: overrides.relatedMaterialSourceIds ?? [],
      publicationState: overrides.publicationState ?? "published",
      provenance: {
        repository: "sachkov-inside/inside-content",
        commit: "c".repeat(40),
        path: `course/tasks/${code}.yaml`,
      },
    };
  }

  async function imported(
    overrides: Parameters<typeof source>[0] = {},
  ): Promise<{
    code: string;
    taskId: string;
    body: ReturnType<typeof source>;
  }> {
    const body = source(overrides);
    const result = await assembleApplySourceTask(importDependencies())(
      { ...body, expectedRevision: null },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    if (!result.ok) throw new Error(result.error.code);
    return { code: body.code, taskId: result.value.taskId, body };
  }

  async function readAll(
    tasks: LearningTasks,
    subject: Subject,
    code: string,
  ): Promise<{ context: string; partCount: number; contextVersion: string }> {
    const first = partSchema.parse(await tasks.read({ subject, code }));
    let context = first.value.data;
    let next = first.value.nextPart;
    while (next !== null) {
      const part = partSchema.parse(
        await tasks.read({
          subject,
          code,
          part: next,
          expectedContextVersion: first.value.contextVersion,
          expectedContentSha256: first.value.contentSha256,
        }),
      );
      expect(part.value.partSha256).toBe(
        createHash("sha256").update(part.value.data).digest("hex"),
      );
      context += part.value.data;
      next = part.value.nextPart;
    }
    expect(createHash("sha256").update(context).digest("hex")).toBe(
      first.value.contentSha256,
    );
    return {
      context,
      partCount: first.value.partCount,
      contextVersion: first.value.contextVersion,
    };
  }

  test("an import is idempotent; only a changed definition creates a new immutable Task Version", async () => {
    const apply = assembleApplySourceTask(importDependencies());
    const body = source();
    const key = randomUUID();
    const first = await apply(
      { ...body, expectedRevision: null },
      { actor: owner, idempotencyKey: key },
    );
    expect(first).toMatchObject({
      ok: true,
      value: { code: body.code, revision: 1, currentVersion: 1 },
    });
    expect(
      await apply(
        { ...body, expectedRevision: null },
        { actor: owner, idempotencyKey: key },
      ),
    ).toEqual(first);
    expect(
      await apply(
        { ...body, title: "Другое", expectedRevision: null },
        { actor: owner, idempotencyKey: key },
      ),
    ).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
    const learnerSubject = await learner();
    expect(
      await apply(
        { ...body, expectedRevision: null },
        { actor: learnerSubject.accountId, idempotencyKey: randomUUID() },
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });

    // Title, access, related Materials and publication change the revision, not the version.
    const renamed = await apply(
      {
        ...body,
        title: "Новое название",
        access: "membership",
        relatedMaterialSourceIds: [relatedSourceId],
        expectedRevision: 1,
      },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(renamed).toMatchObject({
      ok: true,
      value: { revision: 2, currentVersion: 1 },
    });
    const changed = {
      ...definition,
      situation: `${definition.situation} Теперь нужен статус «закрыта».`,
    };
    const versioned = await apply(
      {
        ...body,
        title: "Новое название",
        access: "membership",
        relatedMaterialSourceIds: [relatedSourceId],
        definition: changed,
        expectedRevision: 2,
      },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(versioned).toMatchObject({
      ok: true,
      value: { revision: 3, currentVersion: 2 },
    });
    // The same state under a new key writes nothing.
    const same = await apply(
      {
        ...body,
        title: "Новое название",
        access: "membership",
        relatedMaterialSourceIds: [relatedSourceId],
        definition: changed,
        expectedRevision: 3,
      },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(same).toMatchObject({
      ok: true,
      value: { revision: 3, currentVersion: 2 },
    });
    const versions = await db.prisma.guideTaskVersion.findMany({
      where: { task: { code: body.code } },
      orderBy: { version: "asc" },
    });
    expect(versions.map(({ version }) => version)).toEqual([1, 2]);
    expect(versions[0]?.definition).toEqual(definition);
    await expect(
      db.prisma
        .$executeRaw`update guide_tasks.task_versions set source_path = 'x'`,
    ).rejects.toThrow();
    expect(
      await assembleValidateSourceTask(importDependencies())(body, {
        actor: owner,
      }),
    ).toMatchObject({
      ok: true,
      value: { current: { revision: 3, currentVersion: 2 } },
    });
  });

  test("a stale expected revision conflicts, also when two imports race", async () => {
    const apply = assembleApplySourceTask(importDependencies());
    const body = source();
    const race = await Promise.all(
      ["Первое", "Второе"].map((title) =>
        apply(
          { ...body, title, expectedRevision: null },
          { actor: owner, idempotencyKey: randomUUID() },
        ),
      ),
    );
    expect(race.filter((result) => result.ok)).toHaveLength(1);
    expect(race.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: "task_revision_conflict" } },
    ]);
    expect(
      await apply(
        { ...body, title: "Третье", expectedRevision: 7 },
        { actor: owner, idempotencyKey: randomUUID() },
      ),
    ).toMatchObject({ ok: false, error: { code: "task_revision_conflict" } });
  });

  test("an import without its Guide, chapter or related Material is refused; a code keeps its source", async () => {
    const apply = assembleApplySourceTask(importDependencies());
    const context = () => ({ actor: owner, idempotencyKey: randomUUID() });
    expect(
      await apply(
        { ...source({ guideId: randomUUID() }), expectedRevision: null },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: "guide_not_found" } });
    expect(
      await apply(
        { ...source({ chapterId: otherChapterId }), expectedRevision: null },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: "chapter_not_found" } });
    expect(
      await apply(
        {
          ...source({ relatedMaterialSourceIds: ["inside-content:absent"] }),
          expectedRevision: null,
        },
        context(),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "related_material_not_found",
        sourceIds: ["inside-content:absent"],
      },
    });
    const { body } = await imported();
    expect(
      await apply(
        {
          ...body,
          sourceId: `other-content:${body.code}`,
          expectedRevision: 1,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: "source_mismatch" } });
    expect(
      await apply(
        {
          ...body,
          sourceId: "inside-content:another-code",
          expectedRevision: 1,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_request_shape" } });
    expect(
      await apply(
        {
          ...body,
          definition: {
            ...definition,
            criteria: definition.criteria.map((criterion) => ({
              ...criterion,
              level: "additional",
            })),
          },
          expectedRevision: 1,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_request_shape" } });
  });

  test("access matrix: free, paid with a Guide right, without right, revoked and unpublished", async () => {
    const tasks = learning();
    const free = await imported({ access: "free" });
    const paid = await imported({ access: "membership", position: 2 });
    const hidden = await imported({
      access: "free",
      publicationState: "unpublished",
      position: 3,
    });
    const anybody = await learner();
    const guideHolder = await learner();
    const revoked = await learner();
    const guideGrant = await grant(guideHolder, [`guide:${guideId}`]);
    await revoke(await grant(revoked, [`guide:${guideId}`]));
    void guideGrant;

    const listed = async (subject: Subject) => {
      const result = await tasks.list({ subject, guideSlug });
      if (!result.ok) throw new Error(result.error.code);
      return result.value.tasks.map(({ code }) => code);
    };
    const readCode = async (subject: Subject, code: string) =>
      resultSchema.parse(await tasks.read({ subject, code }));

    for (const subject of [anybody, revoked]) {
      expect(await listed(subject)).toEqual(
        expect.not.arrayContaining([paid.code, hidden.code]),
      );
      expect(await listed(subject)).toContain(free.code);
      expect(await readCode(subject, free.code)).toMatchObject({ ok: true });
      expect(await readCode(subject, paid.code)).toEqual({
        ok: false,
        error: { code: "task_not_available" },
      });
    }
    for (const subject of [guideHolder]) {
      expect(await listed(subject)).toEqual(
        expect.arrayContaining([free.code, paid.code]),
      );
      expect(await listed(subject)).not.toContain(hidden.code);
      expect(await readCode(subject, paid.code)).toMatchObject({ ok: true });
      expect(await readCode(subject, hidden.code)).toEqual({
        ok: false,
        error: { code: "task_not_available" },
      });
    }
    // Only the author still opens an unpublished task.
    const author = { kind: "account" as const, accountId: accountId(owner) };
    expect(await readCode(author, hidden.code)).toMatchObject({ ok: true });
    expect(await readCode(anybody, "no-such-task")).toEqual({
      ok: false,
      error: { code: "task_not_available" },
    });
    // The list follows the programme order inside the chapter.
    const order = (await listed(guideHolder)).filter((code) =>
      [free.code, paid.code].includes(code),
    );
    expect(order).toEqual([free.code, paid.code]);
  });

  test("a read assembles every part without truncation and pins the version between parts", async () => {
    const tasks = learning();
    const long = {
      ...definition,
      situation: "Подробная ситуация заказчика. ".repeat(500).trim(),
    };
    const task = await imported({
      definition: long,
      relatedMaterialSourceIds: [relatedSourceId],
    });
    const subject = await learner();
    const read = await readAll(tasks, subject, task.code);
    expect(read.partCount).toBeGreaterThan(2);
    const parsed = z
      .object({
        contextVersion: z.string(),
        payload: z.object({
          task: z.object({
            code: z.string(),
            version: z.number(),
            definition: z.unknown(),
          }),
          reviewProtocol: z.unknown(),
          relatedMaterials: z.array(z.object({ slug: z.string() }).loose()),
        }),
        terminalMarker: z.string(),
      })
      .parse(JSON.parse(read.context));
    expect(parsed.payload.task).toMatchObject({
      code: task.code,
      version: 1,
      definition: long,
    });
    expect(parsed.payload.reviewProtocol).toEqual(
      JSON.parse(JSON.stringify(taskReviewProtocol)),
    );
    expect(parsed.payload.relatedMaterials).toEqual([
      {
        slug: relatedSlug,
        title: expect.any(String) as unknown,
        availability: "available",
      },
    ]);
    expect(parsed.terminalMarker).toBe(`END_CONTEXT:${read.contextVersion}`);

    const first = partSchema.parse(
      await tasks.read({ subject, code: task.code }),
    );
    await assembleApplySourceTask(importDependencies())(
      {
        ...task.body,
        definition: { ...long, freedom: "Другая свобода." },
        expectedRevision: 1,
      },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(
      await tasks.read({
        subject,
        code: task.code,
        part: 1,
        expectedContextVersion: first.value.contextVersion,
        expectedContentSha256: first.value.contentSha256,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "task_context_version_mismatch" },
    });
  });

  test("submissions append history, keep their version, cover exactly the criteria and replay one key", async () => {
    const tasks = learning();
    const task = await imported();
    const subject = await learner();
    const submit = (submission: Record<string, unknown>) =>
      tasks.submit({ subject, source: "mcp", submission });
    const base = {
      code: task.code,
      taskVersion: 1,
      reviewReport: report(definition),
      note: "Сделал API заявок. Не уверен в дедупликации.",
      serviceMark: {
        repositoryUrl: "https://github.com/learner/consultations",
        branch: "main",
        commit: "a1b2c3d",
        uncommittedChanges: false,
      },
    };
    const key = randomUUID();
    const first = await submit({ ...base, submissionKey: key });
    expect(first).toMatchObject({
      ok: true,
      value: { code: task.code, taskVersion: 1, source: "mcp" },
    });
    expect(await submit({ ...base, submissionKey: key })).toEqual(first);
    expect(
      await submit({ ...base, note: "Другой текст", submissionKey: key }),
    ).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
    expect(
      await submit({
        ...base,
        reviewReport: report(definition, "ownership"),
        submissionKey: randomUUID(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "report_coverage_mismatch", missing: ["ownership"] },
    });
    expect(
      await submit({
        ...base,
        reviewReport: report(definition, undefined, "extra"),
        submissionKey: randomUUID(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "report_coverage_mismatch", unexpected: ["extra"] },
    });
    expect(
      await submit({
        ...base,
        note: "x".repeat(1_001),
        submissionKey: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request_shape" } });

    // A new Task Version refuses a report against the old one; the old submission keeps v1.
    const changed = { ...definition, freedom: "Новая свобода решений." };
    await assembleApplySourceTask(importDependencies())(
      { ...task.body, definition: changed, expectedRevision: 1 },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(await submit({ ...base, submissionKey: randomUUID() })).toEqual({
      ok: false,
      error: {
        code: "task_version_changed",
        submittedVersion: 1,
        currentVersion: 2,
      },
    });
    const second = await submit({
      ...base,
      taskVersion: 2,
      reviewReport: report(changed),
      submissionKey: randomUUID(),
    });
    expect(second).toMatchObject({ ok: true, value: { taskVersion: 2 } });

    const history = await tasks.submissions({ subject, code: task.code });
    expect(history).toMatchObject({
      ok: true,
      value: {
        currentVersion: 2,
        submissions: [
          { taskVersion: 2, authorFeedback: null },
          {
            taskVersion: 1,
            note: base.note,
            serviceMark: { commit: "a1b2c3d", uncommittedChanges: false },
          },
        ],
      },
    });
    await expect(
      db.prisma.$executeRaw`update guide_tasks.submissions set note = ''`,
    ).rejects.toThrow();
  });

  test("author feedback reaches its learner; another learner never sees foreign submissions", async () => {
    const tasks = learning();
    const task = await imported();
    const author = await learner();
    const neighbour = await learner();
    const submitted = await tasks.submit({
      subject: author,
      source: "mcp",
      submission: {
        code: task.code,
        taskVersion: 1,
        submissionKey: randomUUID(),
        reviewReport: report(definition),
        note: "Моя работа.",
      },
    });
    if (!submitted.ok) throw new Error(submitted.error.code);
    await db.prisma.guideTaskAuthorFeedback.create({
      data: {
        submissionId: submitted.value.submissionId,
        comment: "Хорошее разделение владельца.",
        reviewedAt: new Date("2026-10-05T10:00:00Z"),
        updatedBy: owner,
        updatedAt: new Date(),
      },
    });
    expect(
      await tasks.submissions({ subject: author, code: task.code }),
    ).toMatchObject({
      ok: true,
      value: {
        submissions: [
          {
            authorFeedback: {
              comment: "Хорошее разделение владельца.",
              reviewedAt: "2026-10-05T10:00:00.000Z",
            },
          },
        ],
      },
    });
    expect(
      await tasks.submissions({ subject: neighbour, code: task.code }),
    ).toMatchObject({ ok: true, value: { submissions: [] } });
    // A foreign submission key is the neighbour's own key, never the author's submission.
    const neighbourSubmission = await tasks.submit({
      subject: neighbour,
      source: "mcp",
      submission: {
        code: task.code,
        taskVersion: 1,
        submissionKey: "shared-key",
        reviewReport: report(definition),
        note: "",
      },
    });
    expect(neighbourSubmission).toMatchObject({ ok: true });
    expect(
      await tasks.submissions({ subject: author, code: task.code }),
    ).toMatchObject({
      ok: true,
      value: { submissions: [{ note: "Моя работа." }] },
    });
  });

  test("access is checked at submission; submissions return when access returns", async () => {
    const tasks = learning();
    const task = await imported({ access: "membership" });
    const subject = await learner();
    const submission = {
      code: task.code,
      taskVersion: 1,
      reviewReport: report(definition),
      note: "",
    };
    expect(
      await tasks.submit({
        subject,
        source: "mcp",
        submission: { ...submission, submissionKey: randomUUID() },
      }),
    ).toEqual({ ok: false, error: { code: "task_not_available" } });
    const firstGrant = await grant(subject, [`guide:${guideId}`]);
    expect(
      await tasks.submit({
        subject,
        source: "mcp",
        submission: { ...submission, submissionKey: randomUUID() },
      }),
    ).toMatchObject({ ok: true });
    await revoke(firstGrant);
    expect(await tasks.submissions({ subject, code: task.code })).toEqual({
      ok: false,
      error: { code: "task_not_available" },
    });
    expect(
      await tasks.submit({
        subject,
        source: "mcp",
        submission: { ...submission, submissionKey: randomUUID() },
      }),
    ).toEqual({ ok: false, error: { code: "task_not_available" } });
    await grant(subject, [`guide:${guideId}`]);
    expect(await tasks.submissions({ subject, code: task.code })).toMatchObject(
      { ok: true, value: { submissions: [{ taskVersion: 1 }] } },
    );
    const listed = await tasks.list({ subject, guideSlug });
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok) return;
    expect(
      listed.value.tasks.find(({ code }) => code === task.code)
        ?.lastSubmittedAt,
    ).toEqual(expect.any(String));
  });

  test("the setting closes submission, and an Account's hourly submissions are bounded", async () => {
    const task = await imported();
    const subject = await learner();
    const submission = () => ({
      code: task.code,
      taskVersion: 1,
      submissionKey: randomUUID(),
      reviewReport: report(definition),
      note: "",
    });
    expect(
      await learning(false).submit({
        subject,
        source: "mcp",
        submission: submission(),
      }),
    ).toEqual({ ok: false, error: { code: "submissions_disabled" } });
    const tasks = learning();
    for (let index = 0; index < SUBMISSIONS_PER_HOUR; index += 1)
      expect(
        await tasks.submit({
          subject,
          source: "mcp",
          submission: submission(),
        }),
      ).toMatchObject({ ok: true });
    expect(
      await tasks.submit({ subject, source: "mcp", submission: submission() }),
    ).toEqual({ ok: false, error: { code: "submission_rate_limited" } });
    const later = learning(true, () => new Date(Date.now() + 61 * 60 * 1_000));
    expect(
      await later.submit({ subject, source: "mcp", submission: submission() }),
    ).toMatchObject({ ok: true });
  });

  test("over the learner MCP a task is listed, read in full parts, submitted once and found in history", async () => {
    const long = {
      ...definition,
      situation: "Ситуация для чтения частями. ".repeat(500).trim(),
    };
    const task = await imported({ definition: long });
    const closed = await imported({ access: "membership", position: 9 });
    const subject = await learner();
    const server = assembleLearnerMcpServer({
      ...refusingLearnerMcpDependencies(),
      contentAccess,
      tasks: learning(),
      accountId: subject.accountId,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "guide-task-learner", version: "1" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const call = async (name: string, arguments_: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: arguments_ });
      const text = z
        .array(z.object({ type: z.literal("text"), text: z.string() }))
        .parse(result.content)[0]?.text;
      return {
        isError: result.isError === true,
        value: JSON.parse(text ?? "null") as unknown,
      };
    };
    try {
      const list = z
        .object({
          ok: z.literal(true),
          value: z.object({ tasks: z.array(z.object({ code: z.string() })) }),
        })
        .parse((await call("learning_tasks_list", { guideSlug })).value);
      expect(list.value.tasks.map(({ code }) => code)).toContain(task.code);
      expect(list.value.tasks.map(({ code }) => code)).not.toContain(
        closed.code,
      );

      const first = partSchema.parse(
        (await call("learning_task_read", { code: task.code })).value,
      );
      expect(first.value.partCount).toBeGreaterThan(1);
      let context = first.value.data;
      for (let part = 1; part < first.value.partCount; part += 1)
        context += partSchema.parse(
          (
            await call("learning_task_read", {
              code: task.code,
              part,
              expectedContextVersion: first.value.contextVersion,
              expectedContentSha256: first.value.contentSha256,
            })
          ).value,
        ).value.data;
      expect(createHash("sha256").update(context).digest("hex")).toBe(
        first.value.contentSha256,
      );
      expect(JSON.parse(context)).toMatchObject({
        payload: { task: { code: task.code, definition: long } },
      });

      expect(await call("learning_task_read", { code: closed.code })).toEqual({
        isError: true,
        value: { ok: false, error: { code: "task_not_available" } },
      });

      const submission = {
        code: task.code,
        taskVersion: 1,
        submissionKey: randomUUID(),
        reviewReport: report(long),
        note: "Сдаю через агента.",
        serviceMark: { branch: "main", uncommittedChanges: true },
      };
      const submitted = await call("learning_task_submit", submission);
      expect(submitted).toMatchObject({
        isError: false,
        value: { ok: true, value: { taskVersion: 1, source: "mcp" } },
      });
      expect(await call("learning_task_submit", submission)).toEqual(submitted);
      expect(
        await call("learning_task_submissions", { code: task.code }),
      ).toMatchObject({
        isError: false,
        value: {
          ok: true,
          value: {
            submissions: [
              {
                note: "Сдаю через агента.",
                serviceMark: { branch: "main", uncommittedChanges: true },
              },
            ],
          },
        },
      });
    } finally {
      await client.close();
    }
  });

  test("import and submission finish on a one-connection pool: no transaction waits for another connection", async () => {
    const subject = await learner();
    await withExhaustedPool(db, async (prisma) => {
      const poolDirectory = new GuideDirectory(prisma);
      const body = source();
      expect(
        await assembleApplySourceTask({
          prisma,
          directory: poolDirectory,
          authorPolicy,
        })(
          { ...body, expectedRevision: null },
          { actor: owner, idempotencyKey: randomUUID() },
        ),
      ).toMatchObject({ ok: true, value: { revision: 1 } });
      const poolAccess = assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          assembleMaterials({ prisma, authorPolicy }).materialContent,
        ),
        guideTaskResourceFacts: assembleGuideTaskResourceFacts(prisma),
        accountPermissions: {
          hasMaterialsManage: (id) => Promise.resolve(id === owner),
        },
        membershipEntitlements: assembleMembershipEntitlements({
          prisma,
          workshopEntitlements: assembleWorkshopEntitlements({ prisma }),
        }),
      });
      const tasks = assembleLearningTasks({
        prisma,
        directory: poolDirectory,
        contentAccess: poolAccess,
        submissionsEnabled: true,
      });
      expect(
        await tasks.submit({
          subject,
          source: "mcp",
          submission: {
            code: body.code,
            taskVersion: 1,
            submissionKey: randomUUID(),
            reviewReport: report(definition),
            note: "",
          },
        }),
      ).toMatchObject({ ok: true });
    });
  });
});
