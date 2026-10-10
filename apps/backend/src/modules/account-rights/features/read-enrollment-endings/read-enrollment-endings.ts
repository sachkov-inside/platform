import { z } from "zod";
import type {
  AccountRightsPrisma,
  AccountRightsPrismaClient,
} from "../../infrastructure/prisma.js";
import { tierSnapshotSchema } from "../../domain/tariff-assignment.js";

/**
 * Граница конечного неоплаченного доступа: подарок, ручное назначение и любое другое Enrollment
 * с фиксированным концом. Оплаченный доступ сюда не входит: о его продлении и окончании сообщает
 * подписка Billing. Внешний конец Tribute подтверждает источник, поэтому заранее не известен.
 */
export interface EnrollmentEnding {
  readonly enrollmentId: string;
  readonly accountId: string;
  /** Тариф назначения — Offer каталога Billing, на оформление которого ведёт продление. */
  readonly offerId: string;
  /** Название тарифа в принятой ревизии назначения. */
  readonly title: string;
  readonly endsAt: Date;
  /**
   * Другое Enrollment того же Account на тот же тариф действует после границы: доступ на ней не
   * заканчивается. Основание на другой тариф открывает другое и окончания не отменяет.
   */
  readonly continued: boolean;
}

export const enrollmentEndingsQuerySchema = z.strictObject({
  from: z.date(),
  to: z.date(),
  after: z
    .strictObject({ endsAt: z.date(), enrollmentId: z.uuid() })
    .optional(),
  limit: z.int().min(1).max(500),
});
export type EnrollmentEndingsQuery = z.infer<
  typeof enrollmentEndingsQuerySchema
>;

const endingRow = {
  endPolicy: "fixed",
  origin: { not: "platform_payment" },
  revokedAt: null,
} as const;

type EndingRow = {
  readonly id: string;
  readonly accountId: string;
  readonly tierId: string;
  readonly snapshot: unknown;
  readonly endsAt: Date | null;
};

/**
 * Доступ продолжается за границей, если Enrollment того же Account на тот же тариф действует в
 * момент границы и после неё. Основание, которое на границе кончается, продолжением не считается:
 * само Enrollment или оплаченные периоды подписки Billing.
 */
async function continuedAfter(
  prisma: Pick<AccountRightsPrisma, "tariffAssignment">,
  boundary: {
    readonly accountId: string;
    readonly tierId: string;
    readonly endsAt: Date;
  },
  ended:
    { readonly enrollmentId: string } | { readonly subscriptionRef: string },
): Promise<boolean> {
  const following = await prisma.tariffAssignment.count({
    where: {
      accountId: boundary.accountId,
      tierId: boundary.tierId,
      revokedAt: null,
      startsAt: { lte: boundary.endsAt },
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: boundary.endsAt } }] },
        "enrollmentId" in ended
          ? { id: { not: ended.enrollmentId } }
          : // `billingRef` пуст у ручного назначения и подарка; `not` без `null` их бы потерял.
            {
              OR: [
                { billingRef: null },
                { billingRef: { not: ended.subscriptionRef } },
              ],
            },
      ],
    },
  });
  return following > 0;
}

async function ending(
  prisma: Pick<AccountRightsPrisma, "tariffAssignment">,
  row: EndingRow,
): Promise<EnrollmentEnding | undefined> {
  if (row.endsAt === null) return undefined;
  const boundary = row.endsAt;
  return {
    enrollmentId: row.id,
    accountId: row.accountId,
    offerId: row.tierId,
    title: tierSnapshotSchema.parse(row.snapshot).name,
    endsAt: boundary,
    continued: await continuedAfter(
      prisma,
      { accountId: row.accountId, tierId: row.tierId, endsAt: boundary },
      { enrollmentId: row.id },
    ),
  };
}

/** Границы в полуинтервале `(from, to]` по возрастанию; `after` продолжает предыдущую страницу. */
export async function listEnrollmentEndings(
  prisma: AccountRightsPrismaClient,
  query: EnrollmentEndingsQuery,
): Promise<EnrollmentEnding[]> {
  const { from, to, after, limit } = query;
  const rows = await prisma.tariffAssignment.findMany({
    where: {
      ...endingRow,
      endsAt: { gt: from, lte: to },
      ...(after === undefined
        ? {}
        : {
            OR: [
              { endsAt: { gt: after.endsAt } },
              { endsAt: after.endsAt, id: { gt: after.enrollmentId } },
            ],
          }),
    },
    orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  const endings = [];
  for (const row of rows) {
    const found = await ending(prisma, row);
    if (found !== undefined) endings.push(found);
  }
  return endings;
}

/** Текущая граница одного Enrollment; отозванное или ставшее бессрочным границы не имеет. */
export async function readEnrollmentEnding(
  prisma: Pick<AccountRightsPrisma, "tariffAssignment">,
  enrollmentId: string,
): Promise<EnrollmentEnding | undefined> {
  const row = await prisma.tariffAssignment.findFirst({
    where: { ...endingRow, id: z.uuid().parse(enrollmentId) },
  });
  return row === null ? undefined : ending(prisma, row);
}

/** Конец оплаченного срока подписки Billing; тариф подписки — её Offer. */
export const subscriptionContinuationQuerySchema = z.strictObject({
  accountId: z.uuid(),
  offerId: z.uuid(),
  subscriptionRef: z.uuid(),
  paidUntil: z.date(),
});
export type SubscriptionContinuationQuery = z.infer<
  typeof subscriptionContinuationQuerySchema
>;

/**
 * Продолжает ли другое основание доступ за концом оплаченного срока подписки. Enrollment самой
 * подписки — её оплаченные периоды — продолжением не считаются: о них знает сама подписка.
 */
export async function readSubscriptionContinuation(
  prisma: AccountRightsPrismaClient,
  query: SubscriptionContinuationQuery,
): Promise<boolean> {
  return continuedAfter(
    prisma,
    {
      accountId: query.accountId,
      tierId: query.offerId,
      endsAt: query.paidUntil,
    },
    { subscriptionRef: query.subscriptionRef },
  );
}
