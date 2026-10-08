import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { accountId } from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type Subject,
} from "../../src/modules/content-access/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleSubmissionReview } from "../../src/modules/product-tasks/facets/submission-review/submission-review.js";
import { assembleApplySourceTask } from "../../src/modules/product-tasks/features/import-product-task/import-product-task.js";
import {
  assembleLearningTasks,
  type LearningTasks,
} from "../../src/modules/product-tasks/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import {
  assembleMaterialResourceFacts,
  assembleMaterials,
  ProductDirectory,
} from "../../src/modules/materials/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { distinctClock } from "./setup/distinct-clock.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

// An asymmetric matcher is `any`; held as `unknown` it stays out of the typed fixtures.
const anyTimestamp: unknown = expect.any(String);

const definition = (requirement: string) => ({
  schemaVersion: 1 as const,
  situation: "Заказчик хочет видеть заявки участников.",
  result: ["Участник создаёт заявку и видит её статус."],
  freedom: "Стек выбирает участник.",
  criteria: [
    {
      id: "request",
      level: "required" as const,
      requirement,
      acceptableEvidence: ["Сценарий создания."],
    },
    {
      id: "deduplication",
      level: "additional" as const,
      requirement: "Повтор не создаёт вторую заявку.",
      acceptableEvidence: ["Наблюдение повтора."],
    },
  ],
});

describe("Author submissions: list, filters and Author Feedback (#948)", () => {
  let db: TestDatabase;
  const owner = randomUUID();
  const outsider = randomUUID();
  let directory: ProductDirectory;
  let tasks: LearningTasks;
  const productId = randomUUID();
  const otherProductId = randomUUID();
  const firstChapter = randomUUID();
  const secondChapter = randomUUID();
  const otherChapter = randomUUID();
  const authorPolicy = { canManage: (actor: string) => actor === owner };
  const clock = distinctClock();
  const review = () =>
    assembleSubmissionReview({
      prisma: db.prisma,
      directory,
      authorPolicy,
      identities: new TelegramAccountLinks(db.prisma),
      clock,
    });

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, outsider])
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
      });
    directory = new ProductDirectory(db.prisma);
    const materials = assembleMaterials({ prisma: db.prisma, authorPolicy });
    tasks = assembleLearningTasks({
      prisma: db.prisma,
      directory,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          materials.materialContent,
        ),
        productTaskResourceFacts: assembleProductTaskResourceFacts(db.prisma),
        accountPermissions: {
          hasMaterialsManage: (id) => Promise.resolve(id === owner),
        },
        accountRights: assembleAccountRights({
          prisma: db.prisma,
        }),
      }),
      submissionsEnabled: true,
      clock,
    });
    await db.prisma.product.create({
      data: {
        id: productId,
        slug: `review-${productId}`,
        name: "AI Engineering",
      },
    });
    await db.prisma.product.create({
      data: {
        id: otherProductId,
        slug: `other-${otherProductId}`,
        name: "Other",
      },
    });
    await db.prisma.productChapter.createMany({
      data: [
        { id: firstChapter, productId, name: "Глава 1", ordinal: 1 },
        { id: secondChapter, productId, name: "Глава 2", ordinal: 2 },
        {
          id: otherChapter,
          productId: otherProductId,
          name: "Чужая глава",
          ordinal: 1,
        },
      ],
    });
  });
  afterAll(async () => db.dispose());

  async function imported(input: {
    readonly productId: string;
    readonly chapterId: string;
    readonly title: string;
    readonly position?: number;
    readonly publicationState?: "published" | "unpublished";
  }) {
    const code = `review-${randomUUID().slice(0, 8)}`;
    const body = {
      sourceId: `inside-content:${code}`,
      code,
      productId: input.productId,
      chapterId: input.chapterId,
      position: input.position ?? 1,
      title: input.title,
      access: "free" as const,
      definition: definition("Участник создаёт заявку."),
      relatedMaterialSourceIds: [],
      afterMaterialSourceId: null,
      publicationState: input.publicationState ?? "published",
      provenance: {
        repository: "sachkov-inside/inside-content",
        commit: "c".repeat(40),
        path: `course/tasks/${code}.yaml`,
      },
    };
    const result = await assembleApplySourceTask({
      prisma: db.prisma,
      directory,
      authorPolicy,
    })(
      { ...body, expectedRevision: null },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    if (!result.ok) throw new Error(result.error.code);
    return { code, body, revision: result.value.revision };
  }

  async function learner(): Promise<Subject & { kind: "account" }> {
    const id = randomUUID();
    await db.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
    });
    return { kind: "account", accountId: accountId(id) };
  }

  async function submitted(
    subject: Subject & { kind: "account" },
    code: string,
    note: string,
    taskVersion = 1,
  ): Promise<string> {
    const result = await tasks.submit({
      subject,
      source: "mcp",
      submission: {
        code,
        taskVersion,
        submissionKey: randomUUID(),
        reviewReport: {
          criteria: [
            {
              criterionId: "request",
              status: "confirmed",
              evidence: "<script>alert(1)</script> README.md описывает заявку.",
              gap: "",
              obtainedByRun: false,
            },
            {
              criterionId: "deduplication",
              status: "not_verified",
              evidence: "",
              gap: "Повтор не проверен.",
              obtainedByRun: true,
            },
          ],
        },
        note,
        serviceMark: {
          repositoryUrl: "https://github.com/learner/requests",
          branch: "main",
          commit: "abcdef1",
          uncommittedChanges: false,
        },
      },
    });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.submissionId;
  }

  test("only materials:manage reads submissions and writes feedback", async () => {
    expect(await review().list(outsider, {})).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      await review().saveFeedback(outsider, {
        submissionId: randomUUID(),
        comment: "Нет права.",
        reviewed: true,
      }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
  });

  test("submissions come newest first with the person, the report, the service mark and the criteria of their version; filters narrow by Product, chapter and task", async () => {
    const first = await imported({
      productId,
      chapterId: firstChapter,
      title: "Онбординг",
    });
    const second = await imported({
      productId,
      chapterId: secondChapter,
      title: "Заявки",
      publicationState: "unpublished",
    });
    const foreign = await imported({
      productId: otherProductId,
      chapterId: otherChapter,
      title: "Чужое задание",
    });
    const anna = await learner();
    const boris = await learner();
    await db.prisma.telegramAccountLinkState.create({
      data: {
        accountId: anna.accountId,
        identityRef: "telegram:review-anna",
        principalRef: randomUUID(),
        linkRef: randomUUID(),
        revision: 1,
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        updatedAt: new Date(),
      },
    });
    const oldest = await submitted(anna, first.code, "Первая сдача.");
    // A new version after the first submission: the old one keeps its own criteria.
    const changed = await assembleApplySourceTask({
      prisma: db.prisma,
      directory,
      authorPolicy,
    })(
      {
        ...first.body,
        definition: definition("Участник создаёт заявку с темой."),
        expectedRevision: first.revision,
      },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(changed).toMatchObject({ ok: true, value: { currentVersion: 2 } });
    const middle = await submitted(boris, first.code, "Вторая сдача.", 2);
    const foreignSubmission = await submitted(
      boris,
      foreign.code,
      "Чужая глава.",
    );
    // An unpublished task keeps its submissions for the author.
    await db.prisma.productTask.update({
      where: { code: second.code },
      data: { publicationState: "published" },
    });
    const newest = await submitted(anna, second.code, "Третья сдача.");
    await db.prisma.productTask.update({
      where: { code: second.code },
      data: { publicationState: "unpublished" },
    });

    const all = await review().list(owner, { productId });
    if (!all.ok) throw new Error(all.error.code);
    expect(all.value.submissions.map((item) => item.submissionId)).toEqual([
      newest,
      middle,
      oldest,
    ]);
    expect(all.value.nextCursor).toBeNull();
    const product = all.value.products.find((item) => item.id === productId);
    expect(product).toEqual({
      id: productId,
      name: "AI Engineering",
      chapters: [
        {
          id: firstChapter,
          name: "Глава 1",
          tasks: [{ code: first.code, title: "Онбординг" }],
        },
        {
          id: secondChapter,
          name: "Глава 2",
          tasks: [{ code: second.code, title: "Заявки" }],
        },
      ],
    });
    expect(all.value.submissions[2]).toEqual({
      submissionId: oldest,
      submittedAt: anyTimestamp,
      source: "mcp",
      task: {
        code: first.code,
        title: "Онбординг",
        productId,
        productName: "AI Engineering",
        chapterId: firstChapter,
        chapterName: "Глава 1",
        currentVersion: 2,
      },
      taskVersion: 1,
      person: {
        accountId: anna.accountId,
        telegramIdentityRef: "telegram:review-anna",
      },
      note: "Первая сдача.",
      reportText: null,
      reviewReport: {
        criteria: [
          {
            criterionId: "request",
            status: "confirmed",
            evidence: "<script>alert(1)</script> README.md описывает заявку.",
            gap: "",
            obtainedByRun: false,
          },
          {
            criterionId: "deduplication",
            status: "not_verified",
            evidence: "",
            gap: "Повтор не проверен.",
            obtainedByRun: true,
          },
        ],
      },
      serviceMark: {
        repositoryUrl: "https://github.com/learner/requests",
        branch: "main",
        commit: "abcdef1",
        uncommittedChanges: false,
      },
      authorFeedback: null,
    });
    expect(all.value.submissions[1]?.person).toEqual({
      accountId: boris.accountId,
      telegramIdentityRef: null,
    });
    const criteriaOf = (code: string, version: number) =>
      all.value.versions
        .find((item) => item.code === code && item.version === version)
        ?.criteria.map((criterion) => criterion.requirement);
    expect(criteriaOf(first.code, 1)).toEqual([
      "Участник создаёт заявку.",
      "Повтор не создаёт вторую заявку.",
    ]);
    expect(criteriaOf(first.code, 2)).toEqual([
      "Участник создаёт заявку с темой.",
      "Повтор не создаёт вторую заявку.",
    ]);

    const chapter = await review().list(owner, {
      productId,
      chapterId: secondChapter,
    });
    expect(
      chapter.ok && chapter.value.submissions.map((item) => item.submissionId),
    ).toEqual([newest]);
    const task = await review().list(owner, { taskCode: first.code });
    expect(
      task.ok && task.value.submissions.map((item) => item.submissionId),
    ).toEqual([middle, oldest]);
    const everything = await review().list(owner, {});
    expect(
      everything.ok &&
        everything.value.submissions.map((item) => item.submissionId),
    ).toEqual(expect.arrayContaining([foreignSubmission, newest]));

    const page = await review().list(owner, { productId, limit: 2 });
    if (!page.ok) throw new Error(page.error.code);
    expect(page.value.submissions.map((item) => item.submissionId)).toEqual([
      newest,
      middle,
    ]);
    expect(page.value.nextCursor).not.toBeNull();
    const rest = await review().list(owner, {
      productId,
      limit: 2,
      cursor: page.value.nextCursor,
    });
    expect(
      rest.ok && rest.value.submissions.map((item) => item.submissionId),
    ).toEqual([oldest]);
    expect(rest.ok && rest.value.nextCursor).toBeNull();

    expect(await review().list(owner, { productId: "not-a-uuid" })).toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });
    expect(await review().list(owner, { cursor: "broken" })).toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });
  });

  test("the author writes and changes a comment and the reviewed mark with its time; the learner reads them", async () => {
    const task = await imported({
      productId,
      chapterId: firstChapter,
      title: "Отзыв",
    });
    const subject = await learner();
    const submissionId = await submitted(subject, task.code, "Жду отзыва.");

    const reviewed = await review().saveFeedback(owner, {
      submissionId,
      comment: "  Хорошее разделение владельца.  ",
      reviewed: true,
    });
    expect(reviewed).toEqual({
      ok: true,
      value: {
        comment: "Хорошее разделение владельца.",
        reviewedAt: anyTimestamp,
        updatedAt: anyTimestamp,
      },
    });
    const reviewedAt = reviewed.ok ? reviewed.value?.reviewedAt : undefined;

    // Changing the comment keeps the time the author first marked the submission.
    const changed = await review().saveFeedback(owner, {
      submissionId,
      comment: "Посмотри ещё повтор заявки.",
      reviewed: true,
    });
    expect(changed).toMatchObject({
      ok: true,
      value: { comment: "Посмотри ещё повтор заявки.", reviewedAt },
    });
    expect(await tasks.submissions({ subject, code: task.code })).toMatchObject(
      {
        ok: true,
        value: {
          submissions: [
            {
              submissionId,
              authorFeedback: {
                comment: "Посмотри ещё повтор заявки.",
                reviewedAt,
              },
            },
          ],
        },
      },
    );
    const listed = await review().list(owner, { taskCode: task.code });
    expect(listed).toMatchObject({
      ok: true,
      value: {
        submissions: [
          {
            submissionId,
            authorFeedback: {
              comment: "Посмотри ещё повтор заявки.",
              reviewedAt,
            },
          },
        ],
      },
    });

    const unmarked = await review().saveFeedback(owner, {
      submissionId,
      comment: "Посмотри ещё повтор заявки.",
      reviewed: false,
    });
    expect(unmarked).toMatchObject({ ok: true, value: { reviewedAt: null } });

    // An empty comment without the mark leaves no feedback: the learner sees «not reviewed yet».
    expect(
      await review().saveFeedback(owner, {
        submissionId,
        comment: "   ",
        reviewed: false,
      }),
    ).toEqual({ ok: true, value: null });
    expect(await tasks.submissions({ subject, code: task.code })).toMatchObject(
      {
        ok: true,
        value: { submissions: [{ submissionId, authorFeedback: null }] },
      },
    );
  });

  test("a submission of a task whose chapter the author removed stays listed (#948)", async () => {
    const chapter = randomUUID();
    await db.prisma.productChapter.create({
      data: { id: chapter, productId, name: "Глава на удаление", ordinal: 9 },
    });
    const task = await imported({
      productId,
      chapterId: chapter,
      title: "Без главы",
    });
    const submissionId = await submitted(
      await learner(),
      task.code,
      "Глава потом исчезла.",
    );
    // The Product order replaces chapters without asking Product Tasks (`replaceProductChapters`).
    await db.prisma.productChapter.delete({ where: { id: chapter } });
    const listed = await review().list(owner, { productId });
    expect(listed).toMatchObject({ ok: true });
    expect(
      listed.ok &&
        listed.value.submissions.find(
          (item) => item.submissionId === submissionId,
        )?.task,
    ).toMatchObject({ productName: "AI Engineering", chapterName: null });
  });

  test("feedback on an unknown submission or with a malformed body is refused", async () => {
    expect(
      await review().saveFeedback(owner, {
        submissionId: randomUUID(),
        comment: null,
        reviewed: true,
      }),
    ).toEqual({ ok: false, error: { code: "submission_not_found" } });
    expect(
      await review().saveFeedback(owner, {
        submissionId: randomUUID(),
        comment: "x".repeat(4_001),
        reviewed: true,
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request_shape" } });
    expect(
      await review().saveFeedback(owner, {
        submissionId: "not-a-uuid",
        comment: null,
        reviewed: true,
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request_shape" } });
  });
});
