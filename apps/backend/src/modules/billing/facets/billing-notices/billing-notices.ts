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
  cabinetNoticeKindSchema,
  continuesAccessEndingReminder,
  enrollmentOfNotice,
  NOTICE_LIFETIME_MS,
  noticeConditions,
  noticeEventSchema,
  noticeKindSchema,
  noticeViewSchema,
  noticeReaderPath,
  planAccessEnded,
  planAccessEnding,
  planRenewalReminder,
  RENEWAL_REMINDER_LEAD_MS,
  sameNoticeConditions,
  type NoticeEvent,
  type NoticeKind,
  type NoticeOccurrence,
  type NoticeView,
  type RenewalReminderSubject,
} from "../../domain/notice.js";
import { recordBillingNotice } from "../../shared/record-notice.js";
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
/** Страница границ Enrollment за один запрос календаря; пробег читает все страницы окна. */
const ENDING_PAGE_SIZE = 100;
/** Поводы окончания Enrollment: о них сообщают, но в истории покупок их нет. */
const ENROLLMENT_NOTICE_PREFIX = "enrollment:";

/** Чтение границ неоплаченного доступа: строки Enrollment остаются у Membership Entitlements. */
export type EnrollmentEndings = Pick<
  AccessGrants,
  "listEnrollmentEndings" | "readEnrollmentEnding"
>;

/** Строка подписки в доменные значения: привязка и её отзыв не покидают своего владельца. */
function chargeableSubscription(row: SubscriptionRow): RenewalReminderSubject {
  return {
    subscriptionRef: row.id,
    accountId: row.accountId,
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
      if (
        notice.kind === "renewal_reminder" &&
        !(await this.reminderStillDue(notice, now))
      )
        return { status: "superseded" };
      if (
        enrollmentOfNotice(notice.sourceRef) !== undefined &&
        !(await this.accessEndingStillDue(notice, now))
      )
        return { status: "superseded" };
      return {
        status: "current",
        event: stored.data,
        content: {
          category: "subscription",
          kind: noticeKindSchema.parse(notice.kind),
        },
        accountId: notice.accountId,
        title: notice.title,
        readerPath: noticeReaderPath(
          noticeKindSchema.parse(notice.kind),
          notice.sourceRef,
        ),
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
   * отзыв привязки закрывают его. Тот же пробег ведёт границы конечного неоплаченного доступа:
   * напоминание за три дня и сообщение об окончании в момент границы.
   */
  async scheduleReminders(
    limit = 20,
  ): Promise<
    PaymentResult<{ created: number; refreshed: number; superseded: number }>
  > {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return paymentFailure("invalid_request");
    const { prisma } = this.dependencies;
    try {
      // Одно чтение часов на весь пробег: выбор предстоящих списаний, срок повода и проверка его
      // актуальности сверяются между собой, а второе чтение гасило бы только что созданный повод.
      const now = this.clock();
      // Выборка ограничена окном напоминания и подписками, у которых действующего напоминания
      // ещё нет: иначе каждый пробег перебирал бы одни и те же готовые поводы, а последние
      // подписки в очереди не получили бы своего до самого списания.
      const due = await prisma.billingSubscription.findMany({
        where: {
          state: "active",
          paidUntil: {
            gt: now,
            lte: new Date(now.getTime() + RENEWAL_REMINDER_LEAD_MS),
          },
          bindingCiphertext: { not: null },
          bindingRevokedAt: null,
          notices: { none: { kind: "renewal_reminder", state: "current" } },
        },
        orderBy: { paidUntil: "asc" },
        take: limit,
      });
      let created = 0,
        refreshed = 0;
      for (const subscription of due) {
        const outcome = await prisma.$transaction(async (tx) => {
          await lockBillingSubscription(tx, subscription.id);
          const row = await tx.billingSubscription.findUniqueOrThrow({
            where: { id: subscription.id },
          });
          const planned = planRenewalReminder(chargeableSubscription(row), now);
          return planned
            ? await recordBillingNotice(tx, planned, now)
            : "unchanged";
        });
        if (outcome === "created") created += 1;
        if (outcome === "refreshed") refreshed += 1;
      }
      const open = await prisma.billingNotice.findMany({
        where: { kind: "renewal_reminder", state: "current" },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: limit,
      });
      let superseded = 0;
      for (const notice of open) {
        if (await this.reminderStillDue(notice, now)) continue;
        const { count } = await prisma.billingNotice.updateMany({
          where: { id: notice.id, revision: notice.revision, state: "current" },
          data: { state: "superseded", updatedAt: now },
        });
        superseded += count;
      }
      const endings = await this.scheduleAccessEndings(now, limit);
      return {
        ok: true,
        value: {
          created: created + endings.created,
          refreshed: refreshed + endings.refreshed,
          superseded: superseded + endings.superseded,
        },
      };
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
        NOT: { sourceRef: { startsWith: ENROLLMENT_NOTICE_PREFIX } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: CABINET_NOTICE_LIMIT,
    });
    return rows.map((row) =>
      noticeViewSchema.parse({
        noticeRef: row.id,
        kind: cabinetNoticeKindSchema.parse(row.kind),
        state: row.state,
        occurredAt: row.occurredAt.toISOString(),
        amountKopecks:
          row.amountKopecks === null ? null : Number(row.amountKopecks),
        dueAt: row.dueAt?.toISOString() ?? null,
      }),
    );
  }

  /** Напоминание живо, только пока предстоящее списание совпадает с сохранёнными условиями. */
  private async reminderStillDue(
    notice: NoticeRow,
    now: Date,
  ): Promise<boolean> {
    if (!hasText(notice.subscriptionRef)) return false;
    const subscription =
      await this.dependencies.prisma.billingSubscription.findUnique({
        where: { id: notice.subscriptionRef },
      });
    if (!subscription) return false;
    const planned = planRenewalReminder(
      chargeableSubscription(subscription),
      now,
    );
    return (
      planned !== undefined &&
      planned.sourceRef === notice.sourceRef &&
      sameNoticeConditions(planned, noticeConditions(notice))
    );
  }

  /**
   * Границы Enrollment в окне от сроку жизни сообщения об окончании до упреждения напоминания.
   * Пробег читает окно целиком: уже записанный повод не меняется, а следующая граница не ждёт,
   * пока очередь перебирает готовые.
   */
  private async scheduleAccessEndings(
    now: Date,
    limit: number,
  ): Promise<{ created: number; refreshed: number; superseded: number }> {
    const { prisma, enrollments } = this.dependencies;
    let created = 0,
      refreshed = 0;
    let after: { endsAt: Date; enrollmentId: string } | undefined;
    for (;;) {
      const page = await enrollments.listEnrollmentEndings({
        from: new Date(now.getTime() - NOTICE_LIFETIME_MS),
        to: new Date(now.getTime() + ACCESS_ENDING_LEAD_MS),
        ...(after === undefined ? {} : { after }),
        limit: ENDING_PAGE_SIZE,
      });
      if (!page.ok) throw new Error(page.error.code);
      for (const ending of page.value) {
        const outcome = await prisma.$transaction(async (tx) => {
          await lockBillingEnrollmentNotices(tx, ending.enrollmentId);
          const planned =
            ending.endsAt > now
              ? await plannedAccessEnding(tx, ending, now)
              : planAccessEnded(ending, now);
          return planned
            ? await recordBillingNotice(tx, planned, now)
            : "unchanged";
        });
        if (outcome === "created") created += 1;
        if (outcome === "refreshed") refreshed += 1;
      }
      const last = page.value.at(-1);
      if (page.value.length < ENDING_PAGE_SIZE || last === undefined) break;
      after = { endsAt: last.endsAt, enrollmentId: last.enrollmentId };
    }
    const open = await prisma.billingNotice.findMany({
      where: {
        kind: { in: ["access_ending", "access_expired"] },
        state: "current",
        sourceRef: { startsWith: ENROLLMENT_NOTICE_PREFIX },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    let superseded = 0;
    for (const notice of open) {
      if (await this.accessEndingStillDue(notice, now)) continue;
      const { count } = await prisma.billingNotice.updateMany({
        where: { id: notice.id, revision: notice.revision, state: "current" },
        data: { state: "superseded", updatedAt: now },
      });
      superseded += count;
    }
    return { created, refreshed, superseded };
  }

  /**
   * Повод об Enrollment жив, пока его граница та же: перенос, отзыв, бессрочный срок или новое
   * основание после границы закрывают его.
   */
  private async accessEndingStillDue(
    notice: NoticeRow,
    now: Date,
  ): Promise<boolean> {
    const enrollmentId = enrollmentOfNotice(notice.sourceRef);
    if (enrollmentId === undefined) return false;
    const read =
      await this.dependencies.enrollments.readEnrollmentEnding(enrollmentId);
    if (!read.ok) throw new Error(read.error.code);
    const ending = read.value;
    if (ending === null || ending.accountId !== notice.accountId) return false;
    const planned =
      notice.kind === "access_ending"
        ? planAccessEnding(ending, notice.sourceRef, now)
        : planAccessEnded(ending, now);
    return (
      planned !== undefined &&
      planned.kind === notice.kind &&
      planned.sourceRef === notice.sourceRef &&
      sameNoticeConditions(planned, noticeConditions(notice))
    );
  }
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
