import { z } from "zod";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { tierSnapshotSchema } from "../../domain/subscription-enrollment.js";

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

async function ending(
  prisma: MembershipEntitlementsPrismaClient,
  row: EndingRow,
): Promise<EnrollmentEnding | undefined> {
  if (row.endsAt === null) return undefined;
  const boundary = row.endsAt;
  const following = await prisma.subscriptionEnrollment.count({
    where: {
      accountId: row.accountId,
      tierId: row.tierId,
      id: { not: row.id },
      revokedAt: null,
      startsAt: { lte: boundary },
      OR: [{ endsAt: null }, { endsAt: { gt: boundary } }],
    },
  });
  return {
    enrollmentId: row.id,
    accountId: row.accountId,
    offerId: row.tierId,
    title: tierSnapshotSchema.parse(row.snapshot).name,
    endsAt: boundary,
    continued: following > 0,
  };
}

/** Границы в полуинтервале `(from, to]` по возрастанию; `after` продолжает предыдущую страницу. */
export async function listEnrollmentEndings(
  prisma: MembershipEntitlementsPrismaClient,
  query: EnrollmentEndingsQuery,
): Promise<EnrollmentEnding[]> {
  const { from, to, after, limit } = query;
  const rows = await prisma.subscriptionEnrollment.findMany({
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
  prisma: MembershipEntitlementsPrismaClient,
  enrollmentId: string,
): Promise<EnrollmentEnding | undefined> {
  const row = await prisma.subscriptionEnrollment.findFirst({
    where: { ...endingRow, id: z.uuid().parse(enrollmentId) },
  });
  return row === null ? undefined : ending(prisma, row);
}
