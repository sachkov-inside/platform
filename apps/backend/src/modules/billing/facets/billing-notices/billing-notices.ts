import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { NotificationSource } from "../../../notifications/index.js";
import {
  BILLING_CABINET_PATH, noticeConditions, noticeEventSchema, noticeKindSchema, noticeViewSchema,
  planRenewalReminder, RENEWAL_REMINDER_LEAD_MS, sameNoticeConditions,
  type NoticeView, type RenewalReminderSubject,
} from "../../domain/notice.js";
import { lockSubscription } from "../../infrastructure/postgres/catalog-lock.js";
import { recordBillingNotice } from "../../shared/record-notice.js";
import { paymentFailure, type PaymentResult } from "../../features/purchase-subscription/purchase-subscription.contract.js";

type NoticeRow = Awaited<ReturnType<BillingPrismaClient["billingNotice"]["findUniqueOrThrow"]>>;
type SubscriptionRow = Awaited<ReturnType<BillingPrismaClient["billingSubscription"]["findUniqueOrThrow"]>>;

/** Кабинет показывает последние поводы; полная история операций остаётся за #409. */
const CABINET_NOTICE_LIMIT = 20;

/** Строка подписки в доменные значения: привязка и её отзыв не покидают своего владельца. */
function chargeableSubscription(row: SubscriptionRow): RenewalReminderSubject {
  return {
    subscriptionRef: row.id, accountId: row.accountId,
    scheduled: row.state === "active" && row.bindingCiphertext !== null && row.bindingRevokedAt === null,
    snapshot: row.snapshot, pendingChange: row.pendingChange,
    paidUntil: row.paidUntil, nextPeriodIndex: row.periodIndex + 1,
  };
}

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly clock?: () => Date;
}

/**
 * Служебные поводы подписки: их запись принадлежит переходам оплаты и расписания, а этот фасет
 * отвечает на вопрос «повод ещё актуален?», ведёт календарные напоминания и показывает историю
 * кабинету. Форма ответа принадлежит Notifications, как и шаблоны, каналы и сама отправка.
 */
export class BillingNotices {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.clock = dependencies.clock ?? (() => new Date()); }

  /** Проверка перед раскрытием аудитории и перед каждой внешней отправкой. */
  async resolveNotice(input: unknown): Promise<NotificationSource> {
    const parsed = noticeEventSchema.safeParse(input);
    if (!parsed.success) return { status: "superseded" };
    const event = parsed.data;
    const now = this.clock();
    try {
      const notice = await this.dependencies.prisma.billingNotice.findUnique({ where: { id: event.occurrenceRef } });
      // Событие принадлежит поводу целиком: чужой повод, чужой Account или чужой kind не сверяются.
      if (!notice || notice.kind !== event.kind || notice.accountId !== event.accountRef || notice.state !== "current") return { status: "superseded" };
      const current = await this.dependencies.prisma.billingNoticeRevision.findUnique({
        where: { noticeRef_revision: { noticeRef: notice.id, revision: notice.revision } } });
      if (!current || current.messageId !== event.messageId) return { status: "superseded" };
      // Сохранённая revision — источник истины события; нечитаемая не может быть актуальной.
      const stored = noticeEventSchema.safeParse(current.payload);
      if (!stored.success) return { status: "superseded" };
      if (notice.kind === "renewal_reminder" && !await this.reminderStillDue(notice, now)) return { status: "superseded" };
      return {
        status: "current", event: stored.data,
        content: { category: "subscription", kind: noticeKindSchema.parse(notice.kind) },
        accountId: notice.accountId, title: notice.title, readerPath: BILLING_CABINET_PATH,
        ...(notice.amountKopecks === null ? {} : { amountMinor: Number(notice.amountKopecks) }),
        ...(notice.dueAt === null ? {} : { dueAt: notice.dueAt.toISOString() }),
      };
    } catch { return { status: "unavailable" }; }
  }

  /**
   * Календарь напоминаний: за три дня до списания появляется повод с принятыми условиями,
   * изменение даты, суммы или состава выпускает следующую revision, а отмена расписания и
   * отзыв привязки закрывают его.
   */
  async scheduleReminders(limit = 20): Promise<PaymentResult<{ created: number; refreshed: number; superseded: number }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return paymentFailure("invalid_request");
    const { prisma } = this.dependencies;
    try {
      // Одно чтение часов на весь пробег: выбор предстоящих списаний, срок повода и проверка его
      // актуальности сверяются между собой, а второе чтение гасило бы только что созданный повод.
      const now = this.clock();
      // Выборка ограничена окном напоминания и подписками, у которых действующего напоминания
      // ещё нет: иначе каждый пробег перебирал бы одни и те же готовые поводы, а последние
      // подписки в очереди не получили бы своего до самого списания.
      const due = await prisma.billingSubscription.findMany({
        where: { state: "active", paidUntil: { gt: now, lte: new Date(now.getTime() + RENEWAL_REMINDER_LEAD_MS) },
          bindingCiphertext: { not: null }, bindingRevokedAt: null,
          notices: { none: { kind: "renewal_reminder", state: "current" } } },
        orderBy: { paidUntil: "asc" }, take: limit });
      let created = 0, refreshed = 0;
      for (const subscription of due) {
        const outcome = await prisma.$transaction(async tx => {
          await lockSubscription(tx, subscription.id);
          const row = await tx.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
          const planned = planRenewalReminder(chargeableSubscription(row), now);
          return planned ? await recordBillingNotice(tx, planned, now) : "unchanged";
        });
        if (outcome === "created") created += 1;
        if (outcome === "refreshed") refreshed += 1;
      }
      const open = await prisma.billingNotice.findMany({
        where: { kind: "renewal_reminder", state: "current" }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: limit });
      let superseded = 0;
      for (const notice of open) {
        if (await this.reminderStillDue(notice, now)) continue;
        const { count } = await prisma.billingNotice.updateMany({
          where: { id: notice.id, revision: notice.revision, state: "current" }, data: { state: "superseded", updatedAt: now } });
        superseded += count;
      }
      return { ok: true, value: { created, refreshed, superseded } };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  /** История служебных поводов собственного Account для кабинета. */
  async readNotices(accountId: string): Promise<NoticeView[]> {
    const rows = await this.dependencies.prisma.billingNotice.findMany({
      where: { accountId: z.uuid().parse(accountId) }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: CABINET_NOTICE_LIMIT });
    return rows.map(row => noticeViewSchema.parse({
      noticeRef: row.id, kind: row.kind, state: row.state, occurredAt: row.occurredAt.toISOString(),
      amountKopecks: row.amountKopecks === null ? null : Number(row.amountKopecks),
      dueAt: row.dueAt?.toISOString() ?? null,
    }));
  }

  /** Напоминание живо, только пока предстоящее списание совпадает с сохранёнными условиями. */
  private async reminderStillDue(notice: NoticeRow, now: Date): Promise<boolean> {
    if (!notice.subscriptionRef) return false;
    const subscription = await this.dependencies.prisma.billingSubscription.findUnique({ where: { id: notice.subscriptionRef } });
    if (!subscription) return false;
    const planned = planRenewalReminder(chargeableSubscription(subscription), now);
    return planned !== undefined && planned.sourceRef === notice.sourceRef
      && sameNoticeConditions(planned, noticeConditions(notice));
  }
}
