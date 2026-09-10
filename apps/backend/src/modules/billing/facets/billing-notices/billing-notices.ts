import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  BILLING_CABINET_PATH, noticeEventSchema, noticeKindSchema, noticeViewSchema, planRenewalReminder,
  type NoticeEvent, type NoticeKind, type NoticeView,
} from "../../domain/notice.js";
import { lockSubscription } from "../../infrastructure/postgres/catalog-lock.js";
import { recordBillingNotice } from "../../shared/record-notice.js";
import { paymentFailure, type PaymentResult } from "../../features/purchase-subscription/purchase-subscription.contract.js";

/**
 * Ответ источника Notifications. `current` подтверждает повод собственными фактами Billing,
 * `superseded` закрывает устаревшую revision без отправки, `unavailable` означает только
 * временную недоступность источника и разрешает повторный вопрос.
 */
export type BillingNoticeSource =
  | { readonly status: "unavailable" | "superseded" }
  | {
    readonly status: "current"; readonly event: NoticeEvent;
    readonly content: { readonly category: "subscription"; readonly kind: NoticeKind };
    readonly accountId: string; readonly title: string; readonly readerPath: string;
    readonly amountMinor?: number; readonly dueAt?: string;
  };

type NoticeRow = Awaited<ReturnType<BillingPrismaClient["billingNotice"]["findUniqueOrThrow"]>>;

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly clock?: () => Date;
}

/**
 * Служебные поводы подписки: их запись принадлежит переходам оплаты и расписания, а этот фасет
 * отвечает на вопрос «повод ещё актуален?», ведёт календарные напоминания и показывает историю
 * кабинету. Шаблоны, каналы, настройки и сам факт отправки принадлежат Notifications.
 */
export class BillingNotices {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.clock = dependencies.clock ?? (() => new Date()); }

  /** Проверка перед раскрытием аудитории и перед каждой внешней отправкой. */
  async resolveNotice(input: unknown): Promise<BillingNoticeSource> {
    const parsed = noticeEventSchema.safeParse(input);
    if (!parsed.success) return { status: "superseded" };
    const event = parsed.data;
    try {
      const notice = await this.dependencies.prisma.billingNotice.findUnique({ where: { id: event.occurrenceRef } });
      // Событие принадлежит поводу целиком: чужой повод, чужой Account или чужой kind не сверяются.
      if (!notice || notice.kind !== event.kind || notice.accountId !== event.accountRef || notice.state !== "current") return { status: "superseded" };
      const current = await this.dependencies.prisma.billingNoticeRevision.findUnique({
        where: { noticeRef_revision: { noticeRef: notice.id, revision: notice.revision } } });
      if (!current || current.messageId !== event.messageId) return { status: "superseded" };
      if (notice.kind === "renewal_reminder" && !await this.reminderStillDue(notice)) return { status: "superseded" };
      return {
        status: "current", event: noticeEventSchema.parse(current.payload),
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
      const horizon = this.clock();
      const due = await prisma.billingSubscription.findMany({
        where: { state: "active", paidUntil: { gt: horizon } }, orderBy: { paidUntil: "asc" }, take: limit });
      let created = 0, refreshed = 0;
      for (const subscription of due) {
        const outcome = await prisma.$transaction(async tx => {
          // Одно чтение часов решает и то, что списание ещё предстоит, и срок самого повода.
          const now = this.clock();
          await lockSubscription(tx, subscription.id);
          const row = await tx.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
          const planned = planRenewalReminder(row, now);
          return planned ? await recordBillingNotice(tx, planned, now) : "unchanged";
        });
        if (outcome === "created") created += 1;
        if (outcome === "refreshed") refreshed += 1;
      }
      const open = await prisma.billingNotice.findMany({
        where: { kind: "renewal_reminder", state: "current" }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: limit });
      let superseded = 0;
      for (const notice of open) {
        if (await this.reminderStillDue(notice)) continue;
        const { count } = await prisma.billingNotice.updateMany({
          where: { id: notice.id, revision: notice.revision, state: "current" }, data: { state: "superseded", updatedAt: this.clock() } });
        superseded += count;
      }
      return { ok: true, value: { created, refreshed, superseded } };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  /** История служебных поводов собственного Account для кабинета. */
  async readNotices(accountId: string, limit = 20): Promise<NoticeView[]> {
    const rows = await this.dependencies.prisma.billingNotice.findMany({
      where: { accountId: z.uuid().parse(accountId) }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit });
    return rows.map(row => noticeViewSchema.parse({
      noticeRef: row.id, kind: row.kind, state: row.state, occurredAt: row.occurredAt.toISOString(),
      amountKopecks: row.amountKopecks === null ? null : Number(row.amountKopecks),
      dueAt: row.dueAt?.toISOString() ?? null,
    }));
  }

  /** Напоминание живо, только пока предстоящее списание совпадает с сохранёнными условиями. */
  private async reminderStillDue(notice: NoticeRow): Promise<boolean> {
    if (!notice.subscriptionRef) return false;
    const subscription = await this.dependencies.prisma.billingSubscription.findUnique({ where: { id: notice.subscriptionRef } });
    if (!subscription) return false;
    const planned = planRenewalReminder(subscription, this.clock());
    return planned !== undefined && planned.sourceRef === notice.sourceRef && planned.title === notice.title
      && planned.amountKopecks === (notice.amountKopecks === null ? undefined : Number(notice.amountKopecks))
      && planned.dueAt?.getTime() === notice.dueAt?.getTime();
  }
}
