import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { type BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { AccessGrants } from "../../../account-rights/index.js";
import {
  cabinetNoticeKindSchema,
  ENROLLMENT_NOTICE_PREFIX,
  noticeEventSchema,
  noticeKindSchema,
  noticeViewSchema,
  type NoticeEvent,
  type NoticeKind,
  type NoticeView,
  type RenewalReminderSubject,
} from "../../domain/notice.js";

import { renewalScheduled } from "../../shared/renewal-schedule.js";

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
    scheduled: renewalScheduled(row),
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
      readonly purchaseRef?: string;
      readonly amountMinor?: number;
      readonly dueAt?: string;
    };

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
      const purchaseRef = await this.purchaseOfNotice(notice);
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
        ...(purchaseRef === undefined ? {} : { purchaseRef }),
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

  private async purchaseOfNotice(
    notice: NoticeRow,
  ): Promise<string | undefined> {
    if (notice.sourceRef.startsWith("payment:"))
      return z.uuid().parse(notice.sourceRef.slice("payment:".length));
    if (notice.sourceRef.startsWith("refund:")) {
      const refund = await this.dependencies.prisma.billingRefund.findFirst({
        where: {
          id: z.uuid().parse(notice.sourceRef.slice("refund:".length)),
          decision: { accountId: notice.accountId },
        },
        select: { purchaseRef: true },
      });
      return refund?.purchaseRef;
    }
    return undefined;
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

  private async currentReaderPath(
    notice: NoticeRow,
    _now: Date,
  ): Promise<string | undefined> {
    if (
      notice.kind !== "payment_succeeded" &&
      notice.kind !== "refund_resolved"
    )
      return undefined;
    const purchaseRef = await this.purchaseOfNotice(notice);
    return purchaseRef === undefined
      ? undefined
      : `/payment/return?purchaseRef=${encodeURIComponent(purchaseRef)}`;
  }
}
