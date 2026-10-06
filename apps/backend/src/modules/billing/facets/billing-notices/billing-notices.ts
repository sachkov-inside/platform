import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockBillingEnrollmentNotices,
  lockBillingSubscription,
  type BillingPrisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type {
  AccessGrants,
  EnrollmentEnding,
} from "../../../membership-entitlements/index.js";
import {
  ACCESS_ENDING_LEAD_MS,
  accessEndingCyclesPrefix,
  accessEndingSourceRef,
  BILLING_CABINET_PATH,
  cabinetNoticeKindSchema,
  continuesAccessEndingReminder,
  ENROLLMENT_NOTICE_PREFIX,
  enrollmentOfNotice,
  NOTICE_LIFETIME_MS,
  noticeConditions,
  noticeEventSchema,
  noticeKindSchema,
  noticeViewSchema,
  planAccessEnded,
  planAccessEnding,
  planRenewalReminder,
  planSubscriptionEnding,
  RENEWAL_REMINDER_LEAD_MS,
  sameNoticeConditions,
  type NoticeEvent,
  type NoticeKind,
  type NoticeOccurrence,
  type NoticeView,
  type RenewalReminderSubject,
} from "../../domain/notice.js";
import { offerCheckoutPath } from "../../domain/offer-checkout.js";
import { subscriptionSnapshotSchema } from "../../domain/subscription-change.js";
import {
  recordBillingNotice,
  type NoticeOutcome,
} from "../../shared/record-notice.js";
import {
  paymentFailure,
  type PaymentResult,
} from "../../features/purchase-subscription/purchase-subscription.contract.js";
import { hasText } from "../../../../infrastructure/contracts/text.js";

type NoticeRow = Awaited<
  ReturnType<BillingPrismaClient["billingNotice"]["findUniqueOrThrow"]>
>;
type SubscriptionRow = Awaited<
  ReturnType<BillingPrismaClient["billingSubscription"]["findUniqueOrThrow"]>
>;

/** Кабинет показывает последние поводы; полная история операций остаётся за #409. */
const CABINET_NOTICE_LIMIT = 20;
/** Страница границ Enrollment и открытых поводов за один запрос; пробег читает все страницы. */
const CALENDAR_PAGE_SIZE = 100;

/** Чтение границ неоплаченного доступа: строки Enrollment остаются у Membership Entitlements. */
export type EnrollmentEndings = Pick<
  AccessGrants,
  | "listEnrollmentEndings"
  | "readEnrollmentEnding"
  | "readSubscriptionContinuation"
>;

/** Итог одного пробега календаря. */
export interface CalendarCounts {
  readonly created: number;
  readonly refreshed: number;
  readonly superseded: number;
}

/** Строка подписки в доменные значения: привязка и её отзыв не покидают своего владельца. */
function chargeableSubscription(row: SubscriptionRow): RenewalReminderSubject {
  return {
    subscriptionRef: row.id,
    accountId: row.accountId,
    ended: row.state === "ended",
    scheduled:
      row.state === "active" &&
      row.bindingCiphertext !== null &&
      row.bindingRevokedAt === null,
    snapshot: row.snapshot,
    pendingChange: row.pendingChange,
    paidUntil: row.paidUntil,
    nextPeriodIndex: row.periodIndex + 1,
  };
}

/**
 * Ответ источника уведомления, который читает Notifications. Billing описывает его сам и поэтому
 * не зависит от Notifications.
 */
export type BillingNoticeSource =
  | { readonly status: "unavailable" | "superseded" }
  | {
      readonly status: "current";
      readonly event: NoticeEvent;
      readonly content: {
        readonly category: "subscription";
        readonly kind: NoticeKind;
      };
      readonly accountId: string;
      readonly title: string;
      readonly readerPath: string;
      readonly amountMinor?: number;
      readonly dueAt?: string;
    };

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly enrollments: EnrollmentEndings;
  readonly clock?: () => Date;
}

/**
 * Служебные поводы подписки: их запись принадлежит переходам оплаты и расписания, а этот фасет
 * отвечает на вопрос «повод ещё актуален?», ведёт календарные напоминания и показывает историю
 * кабинету. Форма ответа принадлежит Notifications, как и шаблоны, каналы и сама отправка.
 */
export class BillingNotices {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  /** Проверка перед раскрытием аудитории и перед каждой внешней отправкой. */
  async resolveNotice(input: unknown): Promise<BillingNoticeSource> {
    const parsed = noticeEventSchema.safeParse(input);
    if (!parsed.success) return { status: "superseded" };
    const event = parsed.data;
    const now = this.clock();
    try {
      const notice = await this.dependencies.prisma.billingNotice.findUnique({
        where: { id: event.occurrenceRef },
      });
      // Событие принадлежит поводу целиком: чужой повод, чужой Account или чужой kind не сверяются.
      if (
        !notice ||
        notice.kind !== event.kind ||
        notice.accountId !== event.accountRef ||
        notice.state !== "current"
      )
        return { status: "superseded" };
      const current =
        await this.dependencies.prisma.billingNoticeRevision.findUnique({
          where: {
            noticeRef_revision: {
              noticeRef: notice.id,
              revision: notice.revision,
            },
          },
        });
      if (!current || current.messageId !== event.messageId)
        return { status: "superseded" };
      // Сохранённая revision — источник истины события; нечитаемая не может быть актуальной.
      const stored = noticeEventSchema.safeParse(current.payload);
      if (!stored.success) return { status: "superseded" };
      const readerPath = await this.currentReaderPath(notice, now);
      if (readerPath === undefined) return { status: "superseded" };
      return {
        status: "current",
        event: stored.data,
        content: {
          category: "subscription",
          kind: noticeKindSchema.parse(notice.kind),
        },
        accountId: notice.accountId,
        title: notice.title,
        readerPath,
        ...(notice.amountKopecks === null
          ? {}
          : { amountMinor: Number(notice.amountKopecks) }),
        ...(notice.dueAt === null ? {} : { dueAt: notice.dueAt.toISOString() }),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "resolveNotice" },
        error,
        { status: "unavailable" },
      );
    }
  }

  /**
   * Календарь напоминаний: за три дня до списания появляется повод с принятыми условиями,
   * изменение даты, суммы или состава выпускает следующую revision, а отмена расписания и
   * отзыв привязки закрывают его. Тот же пробег ведёт окончание доступа без продления: оплаченного
   * срока без расписания и конечного неоплаченного Enrollment — напоминание за три дня и, для
   * Enrollment, сообщение об окончании в момент границы.
   */
  async scheduleReminders(limit = 20): Promise<PaymentResult<CalendarCounts>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return paymentFailure("invalid_request");
    try {
      // Одно чтение часов на весь пробег: выбор предстоящих списаний, срок повода и проверка его
      // актуальности сверяются между собой, а второе чтение гасило бы только что созданный повод.
      const now = this.clock();
      const counts = { created: 0, refreshed: 0, superseded: 0 };
      const count = (outcome: NoticeOutcome) => {
        if (outcome === "created") counts.created += 1;
        if (outcome === "refreshed") counts.refreshed += 1;
      };
      for (const outcome of await this.scheduleSubscriptionNotices(now, limit))
        count(outcome);
      for (const outcome of await this.scheduleEnrollmentNotices(now))
        count(outcome);
      counts.superseded = await this.supersedeStaleNotices(now);
      return { ok: true, value: counts };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "scheduleReminders" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  /** История служебных поводов собственного Account для кабинета. */
  async readNotices(accountId: string): Promise<NoticeView[]> {
    const rows = await this.dependencies.prisma.billingNotice.findMany({
      where: {
        accountId: z.uuid().parse(accountId),
        // История покупок: поводы окончания доступа без продления к ней не относятся.
        kind: { in: [...cabinetNoticeKindSchema.options] },
        NOT: { sourceRef: { startsWith: ENROLLMENT_NOTICE_PREFIX } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: CABINET_NOTICE_LIMIT,
    });
    return rows.map((row) =>
      noticeViewSchema.parse({
        noticeRef: row.id,
        kind: row.kind,
        state: row.state,
        occurredAt: row.occurredAt.toISOString(),
        amountKopecks:
          row.amountKopecks === null ? null : Number(row.amountKopecks),
        dueAt: row.dueAt?.toISOString() ?? null,
      }),
    );
  }

  /**
   * Подписки внутри окна, у которых действующего повода своего вида ещё нет: напоминание о
   * списании для действующего расписания и об окончании для срока без продления. Так очередь
   * длиннее одного пробега не оставляет последние подписки без повода.
   */
  private async scheduleSubscriptionNotices(
    now: Date,
    limit: number,
  ): Promise<NoticeOutcome[]> {
    const scheduled =
      await this.dependencies.prisma.billingSubscription.findMany({
        where: {
          state: "active",
          paidUntil: this.subscriptionWindow(now),
          bindingCiphertext: { not: null },
          bindingRevokedAt: null,
          notices: { none: { kind: "renewal_reminder", state: "current" } },
        },
        orderBy: { paidUntil: "asc" },
        take: limit,
      });
    const outcomes: NoticeOutcome[] = [];
    // Расписание, отменённое после выборки, получит повод окончания в выборке без продления ниже:
    // там читается, продолжает ли доступ Enrollment.
    for (const subscription of scheduled)
      outcomes.push(
        await this.recordSubscriptionNotice(subscription.id, now, (subject) =>
          planRenewalReminder(subject, now),
        ),
      );
    return [...outcomes, ...(await this.scheduleEndingNotices(now, limit))];
  }

  /**
   * Сроки без продления по возрастанию. Продолжение читается до транзакции: замок подписки
   * Enrollment не охраняет, а перед каждой отправкой `resolveNotice` сверяет его заново.
   * Продолженный срок повода не даёт и ёмкость пробега не занимает: выборка листает дальше.
   */
  private async scheduleEndingNotices(
    now: Date,
    limit: number,
  ): Promise<NoticeOutcome[]> {
    const outcomes: NoticeOutcome[] = [];
    let after: { paidUntil: Date; id: string } | undefined;
    for (;;) {
      const page = await this.dependencies.prisma.billingSubscription.findMany({
        where: {
          state: { in: ["active", "canceled"] },
          paidUntil: this.subscriptionWindow(now),
          notices: { none: { kind: "access_ending", state: "current" } },
          AND: [
            {
              OR: [
                { state: "canceled" },
                { bindingCiphertext: null },
                { bindingRevokedAt: { not: null } },
              ],
            },
            ...(after === undefined
              ? []
              : [
                  {
                    OR: [
                      { paidUntil: { gt: after.paidUntil } },
                      { paidUntil: after.paidUntil, id: { gt: after.id } },
                    ],
                  },
                ]),
          ],
        },
        orderBy: [{ paidUntil: "asc" }, { id: "asc" }],
        take: limit,
      });
      for (const subscription of page) {
        if (await this.continuedAfter(subscription)) continue;
        outcomes.push(
          await this.recordSubscriptionNotice(
            subscription.id,
            now,
            (subject) =>
              planRenewalReminder(subject, now) ??
              planSubscriptionEnding({ ...subject, continued: false }, now),
          ),
        );
        if (outcomes.length === limit) return outcomes;
      }
      const last = page.at(-1);
      if (page.length < limit || last === undefined) return outcomes;
      after = { paidUntil: last.paidUntil, id: last.id };
    }
  }

  private subscriptionWindow(now: Date): { gt: Date; lte: Date } {
    return {
      gt: now,
      lte: new Date(now.getTime() + RENEWAL_REMINDER_LEAD_MS),
    };
  }

  /** Повод подписки под её замком: план читает строку заново, а не выборку до замка. */
  private recordSubscriptionNotice(
    subscriptionRef: string,
    now: Date,
    plan: (subject: RenewalReminderSubject) => NoticeOccurrence | undefined,
  ): Promise<NoticeOutcome> {
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockBillingSubscription(tx, subscriptionRef);
      const planned = plan(
        chargeableSubscription(
          await tx.billingSubscription.findUniqueOrThrow({
            where: { id: subscriptionRef },
          }),
        ),
      );
      return planned
        ? await recordBillingNotice(tx, planned, now)
        : "unchanged";
    });
  }

  /**
   * Границы Enrollment в окне от срока жизни сообщения об окончании до упреждения напоминания.
   * Пробег читает окно целиком: уже записанный повод не меняется, а следующая граница не ждёт,
   * пока очередь перебирает готовые.
   */
  private async scheduleEnrollmentNotices(now: Date): Promise<NoticeOutcome[]> {
    const { prisma, enrollments } = this.dependencies;
    const outcomes: NoticeOutcome[] = [];
    let after: { endsAt: Date; enrollmentId: string } | undefined;
    for (;;) {
      const page = await enrollments.listEnrollmentEndings({
        from: new Date(now.getTime() - NOTICE_LIFETIME_MS),
        to: new Date(now.getTime() + ACCESS_ENDING_LEAD_MS),
        ...(after === undefined ? {} : { after }),
        limit: CALENDAR_PAGE_SIZE,
      });
      if (!page.ok) throw new Error(page.error.code);
      for (const listed of page.value)
        outcomes.push(
          await prisma.$transaction(async (tx) => {
            await lockBillingEnrollmentNotices(tx, listed.enrollmentId);
            // Граница читается заново под замком: параллельный пробег не запишет устаревший срок.
            const ending = await this.readEnding(listed.enrollmentId);
            if (ending === null) return "unchanged";
            const planned =
              ending.endsAt > now
                ? await plannedAccessEnding(tx, ending, now)
                : planAccessEnded(ending, now);
            return planned
              ? await recordBillingNotice(tx, planned, now)
              : "unchanged";
          }),
        );
      const last = page.value.at(-1);
      if (page.value.length < CALENDAR_PAGE_SIZE || last === undefined) break;
      after = { endsAt: last.endsAt, enrollmentId: last.enrollmentId };
    }
    return outcomes;
  }

  /**
   * Закрывает действующие поводы, чьё условие изменилось: напоминания о списании и об окончании и
   * сообщения об окончании Enrollment. Пробег листает все такие поводы, поэтому устаревший не
   * остаётся открытым за длинной очередью ещё актуальных.
   */
  private async supersedeStaleNotices(now: Date): Promise<number> {
    const { prisma } = this.dependencies;
    let superseded = 0;
    let afterId: string | undefined;
    for (;;) {
      const open = await prisma.billingNotice.findMany({
        where: {
          state: "current",
          OR: [
            { kind: { in: ["renewal_reminder", "access_ending"] } },
            { sourceRef: { startsWith: ENROLLMENT_NOTICE_PREFIX } },
          ],
          ...(afterId === undefined ? {} : { id: { gt: afterId } }),
        },
        orderBy: { id: "asc" },
        take: CALENDAR_PAGE_SIZE,
      });
      for (const notice of open) {
        if ((await this.currentReaderPath(notice, now)) !== undefined) continue;
        const { count } = await prisma.billingNotice.updateMany({
          where: { id: notice.id, revision: notice.revision, state: "current" },
          data: { state: "superseded", updatedAt: now },
        });
        superseded += count;
      }
      afterId = open.at(-1)?.id;
      if (open.length < CALENDAR_PAGE_SIZE) return superseded;
    }
  }

  /**
   * Куда ведёт ещё актуальный повод, или `undefined`, если его условие изменилось. Напоминание о
   * списании и история оплаты ведут в кабинет покупок; окончание доступа — на оформление того же
   * Offer, чтобы продлить его покупкой.
   */
  private async currentReaderPath(
    notice: NoticeRow,
    now: Date,
  ): Promise<string | undefined> {
    const enrollmentId = enrollmentOfNotice(notice.sourceRef);
    if (enrollmentId !== undefined) {
      const ending = await this.readEnding(enrollmentId);
      if (ending === null || ending.accountId !== notice.accountId)
        return undefined;
      const planned =
        notice.kind === "access_ending"
          ? planAccessEnding(ending, notice.sourceRef, now)
          : planAccessEnded(ending, now);
      return stillPlanned(notice, planned)
        ? offerCheckoutPath(ending.offerId)
        : undefined;
    }
    if (notice.kind !== "renewal_reminder" && notice.kind !== "access_ending")
      return BILLING_CABINET_PATH;
    if (!hasText(notice.subscriptionRef)) return undefined;
    const subscription =
      await this.dependencies.prisma.billingSubscription.findUnique({
        where: { id: notice.subscriptionRef },
      });
    if (!subscription) return undefined;
    const subject = chargeableSubscription(subscription);
    if (notice.kind === "renewal_reminder")
      return stillPlanned(notice, planRenewalReminder(subject, now))
        ? BILLING_CABINET_PATH
        : undefined;
    const continued = await this.continuedAfter(subscription);
    return stillPlanned(
      notice,
      planSubscriptionEnding({ ...subject, continued }, now),
    )
      ? offerCheckoutPath(
          subscriptionSnapshotSchema.parse(subscription.snapshot).offer.id,
        )
      : undefined;
  }

  /** Продолжает ли Enrollment на тот же Offer доступ за концом оплаченного срока подписки. */
  private async continuedAfter(row: SubscriptionRow): Promise<boolean> {
    const read =
      await this.dependencies.enrollments.readSubscriptionContinuation({
        accountId: row.accountId,
        offerId: subscriptionSnapshotSchema.parse(row.snapshot).offer.id,
        subscriptionRef: row.id,
        paidUntil: row.paidUntil,
      });
    if (!read.ok) throw new Error(read.error.code);
    return read.value;
  }

  private async readEnding(
    enrollmentId: string,
  ): Promise<EnrollmentEnding | null> {
    const read =
      await this.dependencies.enrollments.readEnrollmentEnding(enrollmentId);
    if (!read.ok) throw new Error(read.error.code);
    return read.value;
  }
}

/** Повод жив, пока источник планирует тот же повод с теми же условиями. */
function stillPlanned(
  notice: NoticeRow,
  planned: NoticeOccurrence | undefined,
): boolean {
  return (
    planned !== undefined &&
    planned.kind === notice.kind &&
    planned.sourceRef === notice.sourceRef &&
    sameNoticeConditions(planned, noticeConditions(notice))
  );
}

/**
 * Напоминание о границе продолжает прежний цикл, если граница сдвинулась в пределах окна, иначе
 * начинает следующий: так перенос срока не повторяет сообщение, а продление на месяц не гасит
 * напоминание о новой границе.
 */
async function plannedAccessEnding(
  tx: BillingPrisma,
  ending: EnrollmentEnding,
  now: Date,
): Promise<NoticeOccurrence | undefined> {
  const where = {
    kind: "access_ending",
    sourceRef: { startsWith: accessEndingCyclesPrefix(ending.enrollmentId) },
  };
  const previous = await tx.billingNotice.findFirst({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const sourceRef =
    previous !== null &&
    previous.dueAt !== null &&
    continuesAccessEndingReminder(previous.dueAt, ending.endsAt)
      ? previous.sourceRef
      : accessEndingSourceRef(
          ending.enrollmentId,
          (await tx.billingNotice.count({ where })) + 1,
        );
  return planAccessEnding(ending, sourceRef, now);
}
