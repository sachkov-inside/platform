import {
  registerFixedClock,
  fixedTestInstant,
} from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  moscowDay,
  moscowStartOf,
  shiftDay,
} from "../../src/modules/authoring-overview/domain/overview-period.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { BillingOperations } from "../../src/modules/billing/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { taskDefinitionDigest } from "../../src/modules/product-tasks/domain/task-definition.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  peopleFingerprintKey,
  startPeopleApi,
  type PeopleApi,
} from "./setup/people-api.js";

registerFixedClock();

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const productA = "17190000-0000-4000-8000-00000000000a";
const productB = "17190000-0000-4000-8000-00000000000b";
const archivedProduct = "17190000-0000-4000-8000-00000000000c";
const author = "17190000-0000-4000-8000-0000000000a1";
const topicId = "17190000-0000-4000-8000-0000000000a2";
const chapterA = "17190000-0000-4000-8000-0000000000a3";
const taskA = "17190000-0000-4000-8000-0000000000a4";
const intakeA = "17190000-0000-4000-8000-0000000000a5";
const commentedSubmission = "17190000-0000-4000-8000-0000000000a6";
const awaitingSubmission = "17190000-0000-4000-8000-0000000000a7";
const purchase = (n: number) =>
  `17191000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Every instant of the fixtures comes from the one fixed test instant. */
const instant = fixedTestInstant();
const today = moscowDay(new Date(instant));
/** Moscow start of the day `offset` days from today, plus `hours`. */
const at = (offset: number, hours = 10) =>
  new Date(moscowStartOf(shiftDay(today, offset)).getTime() + hours * HOUR_MS);
/** The first instant of the 7-day period's first day. */
const periodStart = moscowStartOf(shiftDay(today, -6));

const definition = {
  schemaVersion: 1 as const,
  situation: "A participant sees their own request.",
  result: ["The participant sees the request."],
  freedom: "Any implementation.",
  criteria: [
    {
      id: "ownership",
      level: "required" as const,
      requirement: "Requests belong to their participant.",
      acceptableEvidence: ["Ownership is checked."],
    },
  ],
};

const snapshot = (productId: string | null) => ({
  ...(productId === null
    ? {}
    : {
        product: {
          id: productId,
          name: productId === productA ? "Альфа" : "Бета",
          priceRevision: 1,
        },
      }),
  offer: {
    id: "17190000-0000-4000-8000-0000000000d1",
    revision: 1,
    name: "Предложение",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: "17190000-0000-4000-8000-0000000000d2",
    revision: 1,
    offerId: "17190000-0000-4000-8000-0000000000d1",
    months: 1,
    priceKopecks: 150000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 150000,
  renewalPriceKopecks: 150000,
});

type Json = Record<string, unknown>;

/**
 * The admin Overview (#1719) over HTTP on mixed fixtures: metrics with the previous period and the
 * Moscow midnight boundary, attention items whose unknown states count as problems, the merged
 * event feed, learning by Product, the rights of each block, the Product Overview, and the two
 * list filters the attention links open.
 */
describe("Authoring Overview", () => {
  let api: PeopleApi;
  let owner: Record<string, string>;
  let ownerId = "";
  let billingOnly: Record<string, string>;
  let materialsOnly: Record<string, string>;
  let nobody: Record<string, string>;
  const people = {
    anna: "",
    boris: "",
    vera: "",
    visitor: "",
    boundaryNew: "",
    boundaryOld: "",
    quiet: "",
  };

  beforeAll(async () => {
    api = await startPeopleApi();
    const both = await api.signedIn("billing:manage");
    ownerId = both.accountId;
    await api.database.prisma.accountPermission.create({
      data: { accountId: ownerId, permission: "materials:manage" },
    });
    owner = both.headers;
    billingOnly = (await api.signedIn("billing:manage")).headers;
    materialsOnly = (await api.signedIn("materials:manage")).headers;
    nobody = (await api.signedIn(null)).headers;
    const prisma = api.database.prisma;

    await prisma.product.createMany({
      data: [
        { id: productA, name: "Альфа", slug: "overview-alpha" },
        { id: productB, name: "Бета", slug: "overview-beta" },
        {
          id: archivedProduct,
          name: "Архивный",
          slug: "overview-archived",
          archivedAt: new Date(instant - 400 * DAY_MS),
        },
      ],
    });

    // People: registration days around the period boundary; a visitor is never a person.
    people.anna = await api.person({
      registeredAt: at(-1).toISOString(),
      telegram: {
        displayName: "Анна Телеграмова",
        username: "anna_tg",
        marketing: "enabled",
      },
    });
    people.boris = await api.person({
      registeredAt: at(-8).toISOString(),
      billingEmail: "boris@example.test",
    });
    people.vera = await api.person({
      registeredAt: at(-20).toISOString(),
      signInEmail: "vera@example.test",
    });
    people.visitor = await api.person({ registeredAt: at(-2).toISOString() });
    people.boundaryNew = await api.person({
      registeredAt: periodStart.toISOString(),
      signInEmail: "boundary.new@example.test",
    });
    people.boundaryOld = await api.person({
      registeredAt: new Date(periodStart.getTime() - 1).toISOString(),
      signInEmail: "boundary.old@example.test",
    });
    people.quiet = await api.person({
      registeredAt: at(-30).toISOString(),
      signInEmail: "quiet@example.test",
    });

    // Payments: confirmed ones on both sides of the boundary, undetermined and failed ones.
    const payments: {
      n: number;
      state: string;
      productId: string | null;
      amount: bigint;
      confirmedAt: Date | null;
    }[] = [
      {
        n: 1,
        state: "confirmed",
        productId: productA,
        amount: 100000n,
        confirmedAt: at(0),
      },
      {
        n: 2,
        state: "confirmed",
        productId: productB,
        amount: 50000n,
        confirmedAt: at(-3),
      },
      {
        n: 3,
        state: "confirmed",
        productId: productA,
        amount: 70000n,
        confirmedAt: at(-9),
      },
      {
        n: 4,
        state: "confirmed",
        productId: productA,
        amount: 30000n,
        confirmedAt: periodStart,
      },
      {
        n: 5,
        state: "confirmed",
        productId: productB,
        amount: 10000n,
        confirmedAt: new Date(periodStart.getTime() - 1),
      },
      {
        n: 6,
        state: "unknown",
        productId: productA,
        amount: 1000n,
        confirmedAt: null,
      },
      {
        n: 7,
        state: "authorized",
        productId: productB,
        amount: 1000n,
        confirmedAt: null,
      },
      {
        n: 8,
        state: "failed",
        productId: productA,
        amount: 1000n,
        confirmedAt: null,
      },
    ];
    const quote = (n: number) => purchase(100 + n);
    await prisma.billingPriceQuote.createMany({
      data: payments.map((payment) => ({
        id: quote(payment.n),
        accountId: payment.n === 3 ? people.boris : people.anna,
        operationId: purchase(200 + payment.n),
        fingerprint: `overview-${String(payment.n)}`,
        snapshot: snapshot(payment.productId),
        createdAt: new Date(instant - (40 - payment.n) * DAY_MS),
        expiresAt: new Date(instant - (39 - payment.n) * DAY_MS),
      })),
    });
    await prisma.billingPurchase.createMany({
      data: payments.map((payment) => ({
        id: purchase(payment.n),
        quoteRef: quote(payment.n),
        accountId: payment.n === 3 ? people.boris : people.anna,
        state: payment.state,
        kind: "one_time",
        confirmedAt: payment.confirmedAt,
        lifecycleActive: false,
        environment: "demo",
        terminalRef: "OVERVIEW",
        paymentId: String(payment.n),
        amountKopecks: payment.amount,
        snapshot: snapshot(payment.productId),
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        createdAt: new Date(instant - (40 - payment.n) * DAY_MS),
        updatedAt: new Date(instant - (40 - payment.n) * DAY_MS),
      })),
    });
    await prisma.billingFulfillment.createMany({
      data: [
        {
          eventRef: randomUUID(),
          purchaseRef: purchase(1),
          payload: {},
          appliedAt: at(0),
        },
        {
          eventRef: randomUUID(),
          purchaseRef: purchase(2),
          payload: {},
          appliedAt: null,
        },
        {
          eventRef: randomUUID(),
          purchaseRef: purchase(3),
          payload: {},
          appliedAt: null,
          reviewRequiredAt: at(-8),
          reviewReason: "fixture",
        },
        {
          eventRef: randomUUID(),
          purchaseRef: purchase(4),
          payload: {},
          appliedAt: periodStart,
        },
      ],
    });
    // The refund of an earlier payment lands on the day the bank confirmed it.
    const decision = randomUUID();
    await prisma.billingRefundDecision.create({
      data: {
        id: decision,
        purchaseRef: purchase(3),
        accountId: people.boris,
        amountKopecks: 20000n,
        access: "keep",
        recurring: "keep",
        reason: "Частичный возврат",
        state: "executed",
        revision: 1,
        createdAt: at(-2, 9),
        updatedAt: at(-2),
      },
    });
    await prisma.billingRefund.create({
      data: {
        id: randomUUID(),
        decisionRef: decision,
        purchaseRef: purchase(3),
        environment: "demo",
        terminalRef: "OVERVIEW",
        paymentId: "3",
        amountKopecks: 20000n,
        state: "confirmed",
        createdAt: at(-2, 9),
        updatedAt: at(-2),
      },
    });

    // Product Access with its history, each step at its own instant.
    let now = at(-9);
    const accounts = assembleAccounts({
      prisma,
      emailFingerprintKey: peopleFingerprintKey,
    });
    const grants = assembleAccessGrants({
      prisma,
      accounts,
      contentCatalog: new CoverageCatalog(prisma, new ProductDiscovery(prisma)),
      clock: () => now,
    });
    const ok = (result: { ok: boolean }) => {
      if (!result.ok) throw new Error(JSON.stringify(result));
    };
    const issue = async (
      source: "purchase" | "course_activation",
      accountId: string,
      productId: string,
      issuedAt: Date,
    ) =>
      ok(
        await grants.issueProductAccess(
          { source },
          {
            accountId,
            productId,
            sourceRef: `${source}:${accountId}:${productId}`,
            issuedAt: issuedAt.toISOString(),
            reason: "fixture",
          },
        ),
      );
    const change = async (kind: "revoke" | "restore") => {
      const current = await grants.readProductAccess(ownerId, {
        accountId: people.vera,
        productId: productA,
      });
      if (!current.ok) throw new Error(current.error.code);
      const command = {
        accountId: people.vera,
        productId: productA,
        operationId: randomUUID(),
        expectedRevision: current.value.revision,
        reason: kind === "revoke" ? "Отзыв" : "Восстановление",
      };
      ok(
        kind === "revoke"
          ? await grants.revokeProductAccess(ownerId, command)
          : await grants.restoreProductAccess(ownerId, command),
      );
    };
    await issue("purchase", people.boris, productA, now);
    now = periodStart;
    await issue("course_activation", people.boundaryNew, productA, now);
    now = at(-3, 9);
    await issue("purchase", people.anna, productB, now);
    now = at(-2);
    ok(
      await grants.issueManualProductAccess(ownerId, {
        accountId: people.vera,
        productId: productA,
        sourceRef: "manual:vera",
        reason: "Подарок",
      }),
    );
    now = at(-1);
    await change("revoke");
    now = at(0, 9);
    await issue("purchase", people.anna, productA, now);
    now = at(0, 11);
    await change("restore");

    // Learning of Product A: a programme of two Materials, two holders started, three read.
    await prisma.topic.create({
      data: { id: topicId, name: "Overview", slug: "overview" },
    });
    const materials = assembleMaterials({
      prisma,
      authorPolicy: { canManage: (id) => id === author },
    });
    const programme: string[] = [];
    for (const ordinal of [1, 2]) {
      const created = await materials.authoring.createDraft({
        actor: author,
        idempotencyKey: randomUUID(),
        metadata: {
          title: `Урок ${String(ordinal)}`,
          summary: "Overview",
          topicId,
          formatId: "note",
          access: "free",
          tagIds: [],
          difficulty: null,
          outcomes: [],
          productIds: [productA],
        },
        body: representativeDocument("Урок."),
      });
      if (!created.ok) throw new Error(created.error.code);
      const published = await materials.authoring.transitionPublication({
        actor: author,
        idempotencyKey: randomUUID(),
        materialId: created.value.materialId,
        expectedContentVersion: created.value.contentVersion,
        publicationState: "published",
      });
      if (!published.ok) throw new Error(published.error.code);
      await prisma.productProgrammePlacement.create({
        data: {
          id: randomUUID(),
          productId: productA,
          materialId: published.value.materialId,
          chapterId: null,
          ordinal,
        },
      });
      programme.push(published.value.materialId);
    }
    await prisma.readingMaterialState.createMany({
      data: [
        [people.anna, programme[0]],
        [people.anna, programme[1]],
        [people.boris, programme[0]],
        // A read by someone without access counts for nobody.
        [people.quiet, programme[0]],
      ].map(([accountId, materialId]) => ({
        accountId: accountId ?? "",
        materialId: materialId ?? "",
        isRead: true,
        readAt: at(-1),
        version: 1,
        updatedAt: at(-1),
      })),
    });
    await prisma.productLearningStarted.createMany({
      data: [people.anna, people.boris, people.quiet].map((accountId) => ({
        accountId,
        productId: productA,
        startedAt: at(-1),
      })),
    });

    // Waitlist of Product A: joins on both sides; only eligible active members count.
    await prisma.productWaitlistIntake.create({
      data: {
        id: intakeA,
        productId: productA,
        name: "Осенний поток",
        accepting: true,
      },
    });
    await prisma.productWaitlistMembership.createMany({
      data: [people.visitor, people.anna].map((accountId) => ({
        intakeId: intakeA,
        accountId,
        active: true,
        joinedAt: at(-1),
        updatedAt: at(-1),
      })),
    });
    await prisma.productWaitlistEvent.createMany({
      data: [
        { kind: "joined", accountId: people.visitor, occurredAt: at(-1) },
        { kind: "withdrawn", accountId: people.quiet, occurredAt: at(-1) },
        { kind: "joined", accountId: people.anna, occurredAt: at(-8) },
      ].map((event) => ({
        id: randomUUID(),
        intakeId: intakeA,
        source: null,
        ...event,
      })),
    });

    // Submissions: one with Author Feedback, one awaiting it.
    await prisma.productChapter.create({
      data: { id: chapterA, productId: productA, name: "Глава", ordinal: 1 },
    });
    await prisma.$transaction(async (tx) => {
      await tx.productTask.create({
        data: {
          id: taskA,
          code: "overview-task",
          sourceId: "synthetic:overview-task",
          productId: productA,
          chapterId: chapterA,
          position: 1,
          title: "Первое задание",
          access: "free",
          relatedMaterialSourceIds: [],
          publicationState: "published",
          currentVersion: 1,
          revision: 1,
          createdAt: at(-10),
          updatedAt: at(-10),
        },
      });
      await tx.productTaskVersion.create({
        data: {
          taskId: taskA,
          version: 1,
          definition,
          definitionDigest: taskDefinitionDigest(definition),
          sourceRepository: "synthetic/fixtures",
          sourceCommit: "a".repeat(40),
          sourcePath: "overview.json",
          createdAt: at(-10),
        },
      });
    });
    await prisma.productTaskSubmission.createMany({
      data: [
        {
          id: commentedSubmission,
          accountId: people.anna,
          submittedAt: at(-1, 15),
        },
        {
          id: awaitingSubmission,
          accountId: people.boris,
          submittedAt: at(-4),
        },
      ].map((submission, index) => ({
        ...submission,
        taskId: taskA,
        taskVersion: 1,
        submissionKey: `overview-${String(index)}`,
        requestFingerprint: "b".repeat(64),
        source: "form",
        reportText: "Отчёт",
        note: "",
      })),
    });
    await prisma.productTaskAuthorFeedback.create({
      data: {
        submissionId: commentedSubmission,
        comment: "Хорошо",
        reviewedAt: at(0),
        updatedBy: ownerId,
        updatedAt: at(0),
      },
    });

    // Community: only each Account's latest operation counts; undecided and overdue is a problem.
    const operation = async (
      accountId: string,
      revision: number,
      fields: {
        delivery: string;
        createdAt: Date;
        resultStatus?: string;
        observedMembership?: string;
        polledAt?: Date;
      },
    ) =>
      prisma.telegramCommunityOperation.create({
        data: {
          operationId: randomUUID(),
          accountId,
          entitlementRevision: revision,
          purpose: "apply",
          linkRef: randomUUID(),
          linkRevision: 1,
          accountRef: `principal:${accountId}`,
          identityRef: `identity:${accountId}`,
          access: {},
          command: {},
          payloadDigest: "c".repeat(64),
          issuedAt: fields.createdAt,
          nextAttemptAt: fields.createdAt,
          updatedAt: fields.createdAt,
          ...fields,
        },
      });
    const hourAgo = new Date(instant - HOUR_MS);
    await operation(people.anna, 1, {
      delivery: "rejected",
      createdAt: hourAgo,
    });
    await operation(people.anna, 2, {
      delivery: "accepted",
      resultStatus: "applied",
      createdAt: hourAgo,
    });
    await operation(people.boris, 1, {
      delivery: "rejected",
      createdAt: hourAgo,
    });
    await operation(people.vera, 1, {
      delivery: "pending",
      createdAt: new Date(instant - 10 * MINUTE_MS),
    });
    await operation(people.boundaryNew, 1, {
      delivery: "pending",
      createdAt: new Date(instant - MINUTE_MS),
    });
    await operation(people.visitor, 1, {
      delivery: "accepted",
      resultStatus: "failed",
      createdAt: hourAgo,
    });
    await operation(people.quiet, 1, {
      delivery: "accepted",
      resultStatus: "waiting_for_join",
      observedMembership: "not_member",
      polledAt: new Date(instant - MINUTE_MS),
      createdAt: hourAgo,
    });
    await operation(people.boundaryOld, 1, {
      delivery: "accepted",
      createdAt: hourAgo,
    });

    // Telegram deliveries: failed or unknown within 30 days, not skipped.
    const delivery = async (
      accountId: string,
      fields: {
        channel?: string;
        state: string;
        updatedAt: Date;
        recoverySkipped?: boolean;
      },
    ) => {
      const notificationId = randomUUID();
      await prisma.notification.create({
        data: {
          id: notificationId,
          kind: "billing.notice-ready",
          occurrenceRef: randomUUID(),
          accountId,
          eventPayload: "{}",
          sourceRevision: 1,
          createdAt: fields.updatedAt,
        },
      });
      await prisma.notificationDelivery.create({
        data: {
          id: randomUUID(),
          notificationId,
          channel: fields.channel ?? "telegram",
          state: fields.state,
          recoverySkipped: fields.recoverySkipped ?? false,
          updatedAt: fields.updatedAt,
        },
      });
    };
    await delivery(people.anna, {
      state: "failed",
      updatedAt: new Date(instant - DAY_MS),
    });
    await delivery(people.boris, {
      state: "unknown",
      updatedAt: new Date(instant - 2 * DAY_MS),
    });
    await delivery(people.boris, {
      state: "failed",
      updatedAt: new Date(instant - 3 * DAY_MS),
    });
    await delivery(people.vera, {
      state: "sent",
      updatedAt: new Date(instant - DAY_MS),
    });
    await delivery(people.vera, {
      channel: "email",
      state: "failed",
      updatedAt: new Date(instant - DAY_MS),
    });
    await delivery(people.quiet, {
      state: "failed",
      recoverySkipped: true,
      updatedAt: new Date(instant - DAY_MS),
    });
    // An old failure has aged out; an old unknown result is still a problem.
    await delivery(people.boundaryOld, {
      state: "failed",
      updatedAt: new Date(instant - 31 * DAY_MS),
    });
    await delivery(people.vera, {
      state: "unknown",
      updatedAt: new Date(instant - 90 * DAY_MS),
    });
    // A visitor's problem is no person's: neither the count nor the list shows it.
    await delivery(people.visitor, {
      state: "failed",
      updatedAt: new Date(instant - DAY_MS),
    });
  });

  afterAll(async () => {
    await api.close();
  });

  const read = (headers: Record<string, string>, query = "") =>
    api.server.inject({
      method: "GET",
      url: `/admin/overview${query}`,
      headers,
    });
  const readProduct = (
    headers: Record<string, string>,
    productId: string,
    query = "",
  ) =>
    api.server.inject({
      method: "GET",
      url: `/admin/products/${productId}/overview${query}`,
      headers,
    });
  const days = (offset: number) => shiftDay(today, offset);
  const zeros = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      date: days(from + index),
      value: 0,
    }));
  const series = (
    from: number,
    count: number,
    values: Record<number, number>,
  ) => {
    const daily = zeros(from, count).map((day, index) => ({
      date: day.date,
      value: values[from + index] ?? 0,
    }));
    return { total: daily.reduce((sum, day) => sum + day.value, 0), daily };
  };

  test("the owner reads metrics with the previous period, split at Moscow midnight", async () => {
    const response = await read(owner, "?period=7");
    expect(response.statusCode).toBe(200);
    const body = response.json<Json>();
    expect(body["period"]).toEqual({
      days: 7,
      timeZone: "Europe/Moscow",
      current: {
        from: periodStart.toISOString(),
        to: moscowStartOf(days(1)).toISOString(),
        firstDay: days(-6),
        lastDay: today,
      },
      previous: {
        from: moscowStartOf(days(-13)).toISOString(),
        to: periodStart.toISOString(),
        firstDay: days(-13),
        lastDay: days(-7),
      },
    });
    expect(body["metrics"]).toEqual({
      state: "ready",
      revenue: {
        state: "ready",
        current: series(-6, 7, {
          [-6]: 30000,
          [-3]: 50000,
          [-2]: -20000,
          0: 100000,
        }),
        previous: series(-13, 7, { [-9]: 70000, [-7]: 10000 }),
      },
      sales: {
        state: "ready",
        current: series(-6, 7, { [-6]: 1, [-3]: 1, 0: 1 }),
        previous: series(-13, 7, { [-9]: 1, [-7]: 1 }),
      },
      newAccess: {
        state: "ready",
        current: series(-6, 7, { [-6]: 1, [-3]: 1, [-2]: 1, 0: 1 }),
        previous: series(-13, 7, { [-9]: 1 }),
        byOrigin: { purchase: 2, course_activation: 1, manual: 1, other: 0 },
      },
      newAccounts: {
        state: "ready",
        current: series(-6, 7, { [-6]: 1, [-1]: 1 }),
        previous: series(-13, 7, { [-8]: 1, [-7]: 1 }),
      },
      waitlistJoins: {
        state: "ready",
        current: series(-6, 7, { [-1]: 1 }),
        previous: series(-13, 7, { [-8]: 1 }),
      },
    });
  });

  test("attention counts current problems; unknown states are problems, replaced ones are not", async () => {
    const body = (await read(owner)).json<Json>();
    expect(body["attention"]).toEqual({
      undeterminedPayments: { state: "ready", count: 2 },
      fulfillmentIncomplete: { state: "ready", count: 2 },
      // People only, as the lists these items open: the visitor's failures are not counted.
      communityFailures: { state: "ready", count: 3 },
      telegramDeliveryFailures: { state: "ready", count: 3 },
      submissionsAwaitingFeedback: { state: "ready", count: 1 },
    });
  });

  test("events merge payments, access and submissions newest first with Telegram names only", async () => {
    const body = (await read(owner)).json<{
      events: {
        items: Json[];
        payments: string;
        access: string;
        submissions: string;
      };
    }>();
    expect(body.events.payments).toBe("ready");
    expect(body.events.access).toBe("ready");
    expect(body.events.submissions).toBe("ready");
    const anna = {
      accountId: people.anna,
      name: "Анна Телеграмова",
      username: "anna_tg",
    };
    const plain = (accountId: string) => ({
      accountId,
      name: null,
      username: null,
    });
    const alpha = { id: productA, name: "Альфа" };
    const beta = { id: productB, name: "Бета" };
    expect(body.events.items).toEqual([
      {
        kind: "access_restored",
        occurredAt: at(0, 11).toISOString(),
        person: plain(people.vera),
        product: alpha,
      },
      {
        kind: "payment_confirmed",
        occurredAt: at(0).toISOString(),
        person: anna,
        purchaseRef: purchase(1),
        amountKopecks: 100000,
        product: alpha,
      },
      {
        kind: "access_issued",
        occurredAt: at(0, 9).toISOString(),
        person: anna,
        origin: "purchase",
        product: alpha,
      },
      {
        kind: "submission",
        occurredAt: at(-1, 15).toISOString(),
        person: anna,
        submissionId: commentedSubmission,
        commented: true,
        product: alpha,
        taskTitle: "Первое задание",
      },
      {
        kind: "access_revoked",
        occurredAt: at(-1).toISOString(),
        person: plain(people.vera),
        product: alpha,
      },
      {
        kind: "access_issued",
        occurredAt: at(-2).toISOString(),
        person: plain(people.vera),
        origin: "manual",
        product: alpha,
      },
      {
        kind: "payment_confirmed",
        occurredAt: at(-3).toISOString(),
        person: anna,
        purchaseRef: purchase(2),
        amountKopecks: 50000,
        product: beta,
      },
      {
        kind: "access_issued",
        occurredAt: at(-3, 9).toISOString(),
        person: anna,
        origin: "purchase",
        product: beta,
      },
      {
        kind: "submission",
        occurredAt: at(-4).toISOString(),
        person: plain(people.boris),
        submissionId: awaitingSubmission,
        commented: false,
        product: alpha,
        taskTitle: "Первое задание",
      },
      {
        kind: "access_issued",
        occurredAt: periodStart.toISOString(),
        person: plain(people.boundaryNew),
        origin: "course_activation",
        product: alpha,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("@example.test");
  });

  test("learning lists every current Product by holders with started and mean progress", async () => {
    const body = (await read(owner)).json<Json>();
    expect(body["learning"]).toEqual({
      state: "ready",
      products: [
        {
          productId: productA,
          name: "Альфа",
          holders: 4,
          started: 2,
          averageProgress: 3 / 8,
        },
        {
          productId: productB,
          name: "Бета",
          holders: 1,
          started: 0,
          averageProgress: null,
        },
      ],
    });
  });

  test("the funnel shows the full report's default Product for the current period", async () => {
    const body = (await read(owner)).json<{
      funnel: {
        state: string;
        product: unknown;
        steps: Record<string, unknown>;
      };
    }>();
    expect(body.funnel).toMatchObject({ state: "ready" });
    expect([
      { id: productA, name: "Альфа" },
      { id: productB, name: "Бета" },
    ]).toContainEqual(body.funnel.product);
    // No bot event has reached Platform: the bot step is unknown, not zero.
    expect(body.funnel.steps).toMatchObject({
      entered: null,
      checkout: 0,
      paid: 0,
    });
    expect(Object.keys(body.funnel.steps).sort()).toEqual([
      "checkout",
      "entered",
      "openedChapter",
      "paid",
    ]);
  });

  test("a period without facts has every day at zero in both periods", async () => {
    vi.setSystemTime(Date.parse("2031-01-15T09:00:00.000Z"));
    // A token signed at the fixtures' instant has expired by then: sign in again.
    const later = (await api.signedIn("billing:manage")).headers;
    const response = await read(later, "?period=30");
    expect(response.statusCode).toBe(200);
    const body = response.json<{ metrics: Json }>();
    const zeros30 = (lastDay: string) => ({
      total: 0,
      daily: Array.from({ length: 30 }, (_, index) => ({
        date: shiftDay(lastDay, index - 29),
        value: 0,
      })),
    });
    const empty = {
      state: "ready",
      current: zeros30("2031-01-15"),
      previous: zeros30("2030-12-16"),
    };
    expect(empty.previous.daily[0]?.date).toBe("2030-11-17");
    expect(body.metrics).toEqual({
      state: "ready",
      revenue: empty,
      sales: empty,
      newAccess: {
        ...empty,
        byOrigin: { purchase: 0, course_activation: 0, manual: 0, other: 0 },
      },
      newAccounts: empty,
      waitlistJoins: empty,
    });
  });

  test("a materials-only author sees submissions and forbidden sales blocks, never names", async () => {
    const response = await read(materialsOnly);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      metrics: Json;
      funnel: Json;
      learning: Json;
      attention: Json;
      events: {
        items: { kind: string; person: Json }[];
        payments: string;
        access: string;
        submissions: string;
      };
    }>();
    expect(body.metrics).toEqual({ state: "forbidden" });
    expect(body.funnel).toEqual({ state: "forbidden" });
    expect(body.learning).toEqual({ state: "forbidden" });
    expect(body.attention).toEqual({
      undeterminedPayments: { state: "forbidden" },
      fulfillmentIncomplete: { state: "forbidden" },
      communityFailures: { state: "forbidden" },
      telegramDeliveryFailures: { state: "forbidden" },
      submissionsAwaitingFeedback: { state: "ready", count: 1 },
    });
    expect(body.events.payments).toBe("forbidden");
    expect(body.events.access).toBe("forbidden");
    expect(body.events.submissions).toBe("ready");
    expect(body.events.items.map((item) => item.kind)).toEqual([
      "submission",
      "submission",
    ]);
    expect(body.events.items[0]?.person).toEqual({
      accountId: people.anna,
      name: null,
      username: null,
    });
  });

  test("a billing-only owner sees sales blocks and forbidden submissions", async () => {
    const body = (await read(billingOnly)).json<{
      attention: Json;
      events: { items: { kind: string }[]; submissions: string };
      metrics: Json;
    }>();
    expect(body.metrics).toMatchObject({ state: "ready" });
    expect(body.attention["submissionsAwaitingFeedback"]).toEqual({
      state: "forbidden",
    });
    expect(body.events.submissions).toBe("forbidden");
    expect(body.events.items.some((item) => item.kind === "submission")).toBe(
      false,
    );
  });

  test("another role is refused before the request is read; a malformed period is rejected", async () => {
    for (const query of ["", "?period=8"]) {
      const refused = await read(nobody, query);
      expect(refused.statusCode).toBe(403);
      expect(refused.json<Json>()["code"]).toBe("forbidden");
    }
    for (const query of ["?period=8", "?period=30&period=7", "?other=1"])
      expect((await read(owner, query)).statusCode).toBe(400);
    const product = await readProduct(materialsOnly, "not-a-uuid", "?period=8");
    expect(product.statusCode).toBe(403);
  });

  test("the Product Overview reads one Product's holders, sales, waitlist, learning and events", async () => {
    const response = await readProduct(owner, productA, "?period=7");
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      events: { state: string; items: { kind: string; occurredAt: string }[] };
    }>();
    expect(body).toMatchObject({
      holders: {
        state: "ready",
        active: 4,
        byOrigin: { purchase: 2, course_activation: 1, manual: 1, other: 0 },
      },
      revenue: {
        state: "ready",
        current: series(-6, 7, { [-6]: 30000, [-2]: -20000, 0: 100000 }),
        previous: series(-13, 7, { [-9]: 70000 }),
      },
      sales: {
        state: "ready",
        current: series(-6, 7, { [-6]: 1, 0: 1 }),
        previous: series(-13, 7, { [-9]: 1 }),
      },
      waitlist: {
        state: "ready",
        intake: { name: "Осенний поток", active: 1 },
      },
      learning: {
        state: "ready",
        holders: 4,
        started: 2,
        averageProgress: 3 / 8,
      },
    });
    const { events } = body;
    expect(events.state).toBe("ready");
    expect(events.items.map((item) => [item.kind, item.occurredAt])).toEqual([
      ["access_restored", at(0, 11).toISOString()],
      ["payment_confirmed", at(0).toISOString()],
      ["access_issued", at(0, 9).toISOString()],
      ["access_revoked", at(-1).toISOString()],
      ["access_issued", at(-2).toISOString()],
      ["access_issued", periodStart.toISOString()],
      ["payment_confirmed", periodStart.toISOString()],
      ["access_issued", at(-9).toISOString()],
      ["payment_confirmed", at(-9).toISOString()],
    ]);
    const beta = (await readProduct(owner, productB)).json<Json>();
    expect(beta["waitlist"]).toEqual({ state: "ready", intake: null });
  });

  test("the Product Overview requires billing:manage and a known Product", async () => {
    expect((await readProduct(materialsOnly, productA)).statusCode).toBe(403);
    expect((await readProduct(nobody, productA)).statusCode).toBe(403);
    const missing = await readProduct(owner, randomUUID());
    expect(missing.statusCode).toBe(404);
    expect(missing.json<Json>()["code"]).toBe("product_not_found");
    expect((await readProduct(owner, "not-a-uuid")).statusCode).toBe(400);
    expect((await readProduct(owner, productA, "?period=1")).statusCode).toBe(
      400,
    );
  });

  test("the people list narrows to the Accounts each Telegram attention item counts", async () => {
    const list = async (query: string) => {
      const response = await api.server.inject({
        method: "GET",
        url: `/authoring/people${query}`,
        headers: owner,
      });
      expect(response.statusCode).toBe(200);
      return response.json<{
        items: { accountId: string }[];
        total: number;
        nextCursor: string | null;
      }>();
    };
    const community = await list("?telegram=community_failed");
    // The visitor's failed operation counts in the Overview, but a visitor is no person.
    expect(new Set(community.items.map((item) => item.accountId))).toEqual(
      new Set([people.boris, people.vera, people.boundaryOld]),
    );
    expect(community.total).toBe(3);
    const delivery = await list("?telegram=delivery_failed");
    expect(delivery.items.map((item) => item.accountId)).toEqual([
      people.anna,
      people.boris,
      people.vera,
    ]);
    expect(delivery.total).toBe(3);
    const combined = await list(
      `?telegram=community_failed&productId=${productA}&state=active`,
    );
    expect(new Set(combined.items.map((item) => item.accountId))).toEqual(
      new Set([people.boris, people.vera]),
    );
    expect(
      (
        await list(
          `?telegram=community_failed&productId=${productA}&state=revoked`,
        )
      ).total,
    ).toBe(0);
    const narrowed = await list(
      `?telegram=delivery_failed&productId=${productA}&origin=paid`,
    );
    expect(narrowed.items.map((item) => item.accountId)).toEqual([
      people.anna,
      people.boris,
    ]);
    const first = await list("?telegram=delivery_failed&limit=1");
    expect(first.items.map((item) => item.accountId)).toEqual([people.anna]);
    expect(first.nextCursor).not.toBeNull();
    const next = await list(
      `?telegram=delivery_failed&limit=1&cursor=${first.nextCursor ?? ""}`,
    );
    expect(next.items.map((item) => item.accountId)).toEqual([people.boris]);
    const otherScope = await api.server.inject({
      method: "GET",
      url: `/authoring/people?telegram=community_failed&limit=1&cursor=${first.nextCursor ?? ""}`,
      headers: owner,
    });
    expect(otherScope.statusCode).toBe(400);
    expect(
      (
        await api.server.inject({
          method: "GET",
          url: "/authoring/people?telegram=unknown",
          headers: owner,
        })
      ).statusCode,
    ).toBe(400);
  });

  test("another role is refused the Telegram filters without any personal fact", async () => {
    for (const headers of [materialsOnly, nobody])
      for (const telegram of ["community_failed", "delivery_failed"]) {
        const response = await api.server.inject({
          method: "GET",
          url: `/authoring/people?telegram=${telegram}`,
          headers,
        });
        expect(response.statusCode).toBe(403);
        expect(response.body).not.toContain(people.boris);
        expect(response.body).not.toContain("anna_tg");
      }
  });

  test("both Overview reads are private and never stored", async () => {
    for (const response of [
      await read(owner),
      await readProduct(owner, productA),
    ]) {
      expect(response.statusCode).toBe(200);
      const cacheControl = String(response.headers["cache-control"]);
      expect(cacheControl).toContain("private");
      expect(cacheControl).toContain("no-store");
    }
  });

  test("payments.list with fulfillment=incomplete keeps confirmed payments awaiting access", async () => {
    const billing = api.app.get(BillingOperations);
    const page = async (cursor?: string) => {
      const result = await billing.execute(ownerId, {
        operation: "payments.list",
        operationId: randomUUID(),
        fulfillment: "incomplete",
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result.ok || result.result.outcome !== "payments")
        throw new Error(JSON.stringify(result));
      return result.result;
    };
    const first = await page();
    expect(first.items.map((item) => [item.purchaseRef, item.access])).toEqual([
      [purchase(3), "review_required"],
    ]);
    expect(first.nextCursor).toBe(purchase(3));
    // Fulfillment is a state, not scope: the position stays valid after the access is applied.
    await api.database.prisma.billingFulfillment.updateMany({
      where: { purchaseRef: purchase(3) },
      data: { appliedAt: new Date(instant) },
    });
    try {
      const second = await page(first.nextCursor ?? undefined);
      expect(
        second.items.map((item) => [item.purchaseRef, item.access]),
      ).toEqual([[purchase(2), "preparing"]]);
      expect(second.nextCursor).toBeNull();
      expect((await page()).items.map((item) => item.purchaseRef)).toEqual([
        purchase(2),
      ]);
    } finally {
      await api.database.prisma.billingFulfillment.updateMany({
        where: { purchaseRef: purchase(3) },
        data: { appliedAt: null },
      });
    }
  });
});
