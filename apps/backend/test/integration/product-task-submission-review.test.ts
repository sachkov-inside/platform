import { ProductDiscovery } from "../../src/modules/products/index.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import { AccountNames } from "../../src/modules/account-profiles/index.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  accountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
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
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { ProductDirectory } from "../../src/modules/products/index.js";
import { assembleMaterialResourceFacts } from "../../src/modules/materials/index.js";
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
      names: new AccountNames(db.prisma),
      clock,
    });

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, outsider])
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
      });
    directory = new ProductDirectory(
      db.prisma,
      assembleProductMaterialReading(db.prisma),
    );
    const materials = assembleMaterials({ prisma: db.prisma, authorPolicy });
    tasks = assembleLearningTasks({
      prisma: db.prisma,
      directory,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          materials.materialContent,
        ),
        productTaskResourceFacts: assembleProductTaskResourceFacts(
          db.prisma,
          new ProductDiscovery(db.prisma),
        ),
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

  test("saved agent summary survives reads and exact retry but cannot change under the same key", async () => {
    const isolatedProduct = randomUUID();
    const isolatedChapter = randomUUID();
    await db.prisma.product.create({
      data: {
        id: isolatedProduct,
        slug: `summary-${isolatedProduct}`,
        name: "Summary",
      },
    });
    await db.prisma.productChapter.create({
      data: {
        id: isolatedChapter,
        productId: isolatedProduct,
        name: "Summary",
        ordinal: 1,
      },
    });
    const task = await imported({
      productId: isolatedProduct,
      chapterId: isolatedChapter,
      title: "Короткий итог",
    });
    const subject = await learner();
    const submission = {
      code: task.code,
      taskVersion: 1,
      submissionKey: randomUUID(),
      note: "",
      reviewReport: {
        summary: "Заявка создаётся. Повтор ещё не проверен.",
        criteria: [
          {
            criterionId: "request",
            status: "confirmed",
            evidence: "Проверен сценарий создания.",
            gap: "",
            obtainedByRun: true,
          },
          {
            criterionId: "deduplication",
            status: "not_verified",
            evidence: "",
            gap: "Повтор не проверен.",
            obtainedByRun: false,
          },
        ],
      },
    };
    const first = await tasks.submit({ subject, source: "mcp", submission });
    expect(first.ok).toBe(true);
    expect(await tasks.submit({ subject, source: "mcp", submission })).toEqual(
      first,
    );
    const listed = await review().list(owner, { taskCode: task.code });
    expect(
      listed.ok && listed.value.submissions.map((row) => row.reviewReport),
    ).toEqual([submission.reviewReport]);
    expect(
      await tasks.submit({
        subject,
        source: "mcp",
        submission: {
          ...submission,
          reviewReport: { ...submission.reviewReport, summary: "Другой итог." },
        },
      }),
    ).toEqual({ ok: false, error: { code: "idempotency_conflict" } });
  });

  test("author sees all saved checks across list pages, versions and exact retries; form is not a check", async () => {
    const isolatedProduct = randomUUID();
    const isolatedChapter = randomUUID();
    await db.prisma.product.create({
      data: {
        id: isolatedProduct,
        slug: `checks-${isolatedProduct}`,
        name: "Checks",
      },
    });
    await db.prisma.productChapter.create({
      data: {
        id: isolatedChapter,
        productId: isolatedProduct,
        name: "Checks",
        ordinal: 1,
      },
    });
    const task = await imported({
      productId: isolatedProduct,
      chapterId: isolatedChapter,
      title: "История проверок",
    });
    const subject = await learner();
    const save = async (
      status: "confirmed" | "violation" | "not_verified",
      taskVersion: number,
      summary: string,
    ) => {
      const submission = {
        code: task.code,
        taskVersion,
        submissionKey: randomUUID(),
        note: "",
        reviewReport: {
          summary,
          criteria: [
            {
              criterionId: "request",
              status,
              evidence: status === "confirmed" ? "Проверен сценарий." : "",
              gap: status === "confirmed" ? "" : "Нужна проверка.",
              obtainedByRun: false,
            },
            {
              criterionId: "deduplication",
              status: "violation" as const,
              evidence: "Дополнительный сценарий не готов.",
              gap: "Повтор создаёт дубль.",
              obtainedByRun: false,
            },
          ],
        },
      };
      const receipt = await tasks.submit({
        subject,
        source: "mcp",
        submission,
      });
      if (!receipt.ok) throw new Error(receipt.error.code);
      expect(
        await tasks.submit({ subject, source: "mcp", submission }),
      ).toEqual(receipt);
      return receipt.value.submissionId;
    };
    const failed = await save("violation", 1, "Нужны правки.");
    const missing = await save("not_verified", 1, "Не хватает проверки.");
    expect(
      (
        await tasks.submit({
          subject,
          source: "form",
          submission: {
            code: task.code,
            taskVersion: 1,
            submissionKey: randomUUID(),
            note: "Отправлено вручную.",
          },
        })
      ).ok,
    ).toBe(true);
    const changed = await assembleApplySourceTask({
      prisma: db.prisma,
      directory,
      authorPolicy,
    })(
      {
        ...task.body,
        definition: definition("Участник создаёт заявку с темой."),
        expectedRevision: task.revision,
      },
      { actor: owner, idempotencyKey: randomUUID() },
    );
    expect(changed.ok).toBe(true);
    const passed = await save("confirmed", 2, "Самопроверка пройдена.");
    const newest = await review().list(owner, {
      taskCode: task.code,
      limit: 1,
    });
    expect(
      newest.ok &&
        newest.value.submissions.map((row) => ({
          id: row.submissionId,
          check: row.selfCheck,
        })),
    ).toEqual([
      {
        id: passed,
        check: { outcome: "passed", attempt: 3, firstPassedAttempt: 3 },
      },
    ]);
    const detail = await review().list(owner, { submissionId: failed });
    expect(
      detail.ok &&
        detail.value.submissions.map((row) => ({
          id: row.submissionId,
          check: row.selfCheck,
        })),
    ).toEqual([
      {
        id: failed,
        check: { outcome: "changes", attempt: 1, firstPassedAttempt: 3 },
      },
    ]);
    expect(
      detail.ok &&
        detail.value.history.map((row) => ({
          id: row.submissionId,
          outcome: row.selfCheck.outcome,
          attempt: row.selfCheck.attempt,
          version: row.taskVersion,
          summary: row.summary,
        })),
    ).toEqual([
      {
        id: passed,
        outcome: "passed",
        attempt: 3,
        version: 2 as const,
        summary: "Самопроверка пройдена.",
      },
      {
        id: missing,
        outcome: "missing",
        attempt: 2,
        version: 1,
        summary: "Не хватает проверки.",
      },
      {
        id: failed,
        outcome: "changes",
        attempt: 1,
        version: 1,
        summary: "Нужны правки.",
      },
    ]);
  });

  test("author contact comes from the exact current binding and disappears after unlink during lookup", async () => {
    const isolatedProduct = randomUUID();
    const isolatedChapter = randomUUID();
    await db.prisma.product.create({
      data: {
        id: isolatedProduct,
        slug: `contact-${isolatedProduct}`,
        name: "Contact",
      },
    });
    await db.prisma.productChapter.create({
      data: {
        id: isolatedChapter,
        productId: isolatedProduct,
        name: "Contact",
        ordinal: 1,
      },
    });
    const task = await imported({
      productId: isolatedProduct,
      chapterId: isolatedChapter,
      title: "Контакт ученика",
    });
    const subject = await learner();
    const principalRef = randomUUID();
    const identityRef = randomUUID();
    await db.prisma.telegramAccountLinkState.create({
      data: {
        accountId: subject.accountId,
        principalRef,
        identityRef,
        linkRef: randomUUID(),
        revision: 1,
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    await submitted(
      subject,
      task.code,
      "username из заметки не является контактом.",
    );
    let unlink = false;
    const identities = new TelegramAccountLinks(db.prisma, {
      read: async (queries) => {
        expect(queries).toEqual([
          { accountRef: principalRef, telegramIdentityRef: identityRef },
        ]);
        if (unlink)
          await db.prisma.telegramAccountLinkState.update({
            where: { accountId: subject.accountId },
            data: { identityRef: null, principalRef: null, revision: 2 },
          });
        return {
          ok: true as const,
          contacts: [
            {
              accountRef: principalRef,
              telegramIdentityRef: identityRef,
              status: "available" as const,
              displayName: "Анна Иванова",
              username: "anna_course",
            },
          ],
        };
      },
    });
    const author = assembleSubmissionReview({
      prisma: db.prisma,
      directory,
      authorPolicy,
      identities,
      names: new AccountNames(db.prisma),
      clock,
    });
    const current = await author.list(owner, { taskCode: task.code });
    expect(current.ok && current.value.submissions[0]?.person).toEqual({
      accountId: subject.accountId,
      telegramIdentityRef: identityRef,
      displayName: null,
      telegramUsername: "anna_course",
      telegramUrl: "https://t.me/anna_course",
      telegramContactState: "available",
    });
    unlink = true;
    const unlinked = await author.list(owner, { taskCode: task.code });
    expect(unlinked.ok && unlinked.value.submissions[0]?.person).toEqual({
      accountId: subject.accountId,
      telegramIdentityRef: null,
      displayName: null,
      telegramUsername: null,
      telegramUrl: null,
      telegramContactState: "not_linked",
    });
  });

  test("author sees the learner's current profile name without exposing profile details", async () => {
    const isolatedProduct = randomUUID();
    const isolatedChapter = randomUUID();
    await db.prisma.product.create({
      data: {
        id: isolatedProduct,
        slug: `name-${isolatedProduct}`,
        name: "Имя ученика",
      },
    });
    await db.prisma.productChapter.create({
      data: {
        id: isolatedChapter,
        productId: isolatedProduct,
        name: "Старт",
        ordinal: 1,
      },
    });
    const task = await imported({
      productId: isolatedProduct,
      chapterId: isolatedChapter,
      title: "Имя",
    });
    const subject = await learner();
    await db.prisma.accountProfile.create({
      data: {
        accountId: subject.accountId,
        publicProfileId: randomUUID(),
        displayName: "Борис Петров",
        bio: "Частная информация",
        status: "active",
      },
    });
    await submitted(subject, task.code, "Заметка ученика");
    const listed = await review().list(owner, { taskCode: task.code });
    expect(listed.ok && listed.value.submissions[0]?.person.displayName).toBe(
      "Борис Петров",
    );
    expect(listed.ok && listed.value.submissions[0]?.person).not.toHaveProperty(
      "bio",
    );
    await db.prisma.accountProfile.update({
      where: { accountId: subject.accountId },
      data: { displayName: "Борис" },
    });
    const updated = await review().list(owner, { taskCode: task.code });
    expect(updated.ok && updated.value.submissions[0]?.person.displayName).toBe(
      "Борис",
    );
    await db.prisma.accountProfile.update({
      where: { accountId: subject.accountId },
      data: { status: "disabled" },
    });
    const disabled = await review().list(owner, { taskCode: task.code });
    expect(
      disabled.ok && disabled.value.submissions[0]?.person.displayName,
    ).toBeNull();
    expect(
      disabled.ok && disabled.value.submissions[0]?.person,
    ).not.toHaveProperty("avatar");
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "profile-review-test-fingerprint-key-32",
    });
    const authorizedReview = assembleSubmissionReview({
      prisma: db.prisma,
      directory,
      authorPolicy: {
        canManage: async (actor) => {
          const permission = await accounts.checkPermission({
            accountId: accountId(actor),
            permission: "materials:manage",
          });
          return permission.ok && permission.allowed;
        },
      },
      identities: new TelegramAccountLinks(db.prisma),
      names: new AccountNames(db.prisma),
      clock,
    });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "materials:manage" },
    });
    expect(
      (await authorizedReview.list(owner, { taskCode: task.code })).ok,
    ).toBe(true);
    await db.prisma.accountPermission.deleteMany({
      where: { accountId: owner },
    });
    expect(await authorizedReview.list(owner, { taskCode: task.code })).toEqual(
      {
        ok: false,
        error: { code: "forbidden" },
      },
    );
  });

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
      selfCheck: { outcome: "passed", attempt: 1, firstPassedAttempt: 1 },
      person: {
        accountId: anna.accountId,
        telegramIdentityRef: "telegram:review-anna",
        displayName: null,
        telegramUsername: null,
        telegramUrl: null,
        telegramContactState: "unavailable",
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
      displayName: null,
      telegramUsername: null,
      telegramUrl: null,
      telegramContactState: "not_linked",
    });
    const criteriaOf = (code: string, version: number) =>
      all.value.versions
        .find((item) => item.code === code && item.version === version)
        ?.criteria.map((criterion) =>
          "requirement" in criterion ? criterion.requirement : criterion.task,
        );
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

  test("the author narrows submissions to those awaiting feedback or given it, pages under the filter and counts those awaiting (#1720)", async () => {
    const before = await review().countAwaitingFeedback(owner);
    if (!before.ok) throw new Error(before.error.code);
    const task = await imported({
      productId,
      chapterId: firstChapter,
      title: "Фильтр отзыва",
    });
    const subject = await learner();
    const [first, second, third, fourth] = [
      await submitted(subject, task.code, "Первая."),
      await submitted(subject, task.code, "Вторая."),
      await submitted(subject, task.code, "Третья."),
      await submitted(subject, task.code, "Четвёртая."),
    ];
    const save = (
      submissionId: string,
      comment: string | null,
      reviewed = false,
    ) => review().saveFeedback(owner, { submissionId, comment, reviewed });
    // A comment and the «посмотрел автор» mark alone both store Author Feedback.
    expect(await save(second, "Комментарий автора.")).toMatchObject({
      ok: true,
    });
    expect(await save(fourth, null, true)).toMatchObject({ ok: true });
    // A cleared comment without the mark stores nothing: the submission awaits feedback again.
    expect(await save(third, "Временный комментарий.")).toMatchObject({
      ok: true,
    });
    expect(await save(third, "  ")).toEqual({ ok: true, value: null });

    const listed = async (input: Record<string, unknown>) => {
      const result = await review().list(owner, {
        taskCode: task.code,
        ...input,
      });
      if (!result.ok) throw new Error(result.error.code);
      return {
        ids: result.value.submissions.map((item) => item.submissionId),
        nextCursor: result.value.nextCursor,
      };
    };
    expect((await listed({})).ids).toEqual([fourth, third, second, first]);
    expect((await listed({ feedback: "awaiting" })).ids).toEqual([
      third,
      first,
    ]);
    expect((await listed({ feedback: "given" })).ids).toEqual([fourth, second]);

    // The client resends the filter with its cursor; the next page continues the filtered order.
    for (const [feedback, expected] of [
      ["awaiting", [third, first]],
      ["given", [fourth, second]],
    ] as const) {
      const page = await listed({ feedback, limit: 1 });
      expect(page.ids).toEqual([expected[0]]);
      expect(page.nextCursor).not.toBeNull();
      const next = await listed({
        feedback,
        limit: 1,
        cursor: page.nextCursor,
      });
      expect(next).toEqual({ ids: [expected[1]], nextCursor: null });
      // The cursor keeps the filter it was produced under: another filter or none is refused.
      for (const other of [
        { feedback: feedback === "awaiting" ? "given" : "awaiting" },
        {},
      ])
        expect(
          await review().list(owner, {
            taskCode: task.code,
            limit: 1,
            cursor: page.nextCursor,
            ...other,
          }),
        ).toEqual({ ok: false, error: { code: "invalid_request_shape" } });
      // A detail read opened from a filtered page ignores the cursor and its filter.
      expect(
        (
          await listed({
            submissionId: expected[0],
            cursor: page.nextCursor,
          })
        ).ids,
      ).toEqual([expected[0]]);
    }

    // The detail read ignores the filter, so a submission stays readable once its comment is saved.
    expect(
      (await listed({ submissionId: second, feedback: "awaiting" })).ids,
    ).toEqual([second]);
    expect(await review().list(owner, { feedback: "reviewed" })).toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });

    const awaiting = await review().countAwaitingFeedback(owner);
    expect(awaiting).toEqual({
      ok: true,
      value: { count: before.value.count + 2 },
    });
    expect(await save(first, "Теперь с комментарием.")).toMatchObject({
      ok: true,
    });
    expect(await review().countAwaitingFeedback(owner)).toEqual({
      ok: true,
      value: { count: before.value.count + 1 },
    });

    // Without materials:manage both the filtered list and the counter are refused, not empty.
    expect(await review().list(outsider, { feedback: "awaiting" })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await review().countAwaitingFeedback(outsider)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
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
