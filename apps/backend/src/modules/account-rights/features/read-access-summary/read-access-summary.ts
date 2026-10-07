import { readTimedEnrollmentAccess } from "../../shared/timed-enrollment-access.js";
import type {
  AccessGround,
  InvitationFunnel,
} from "../../domain/access-roster.js";
import { invitationState } from "../../domain/invitation.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  enrollmentGround,
  grantGround,
  standaloneGrantSources,
} from "../../shared/access-ground.js";

/** Действующее основание и его Account: из них Billing считает людей по Offer и сроки. */
export interface ActiveAccessGround {
  readonly accountId: string;
  readonly ground: AccessGround;
  /** Actual end of all rights; the assignment itself can remain unlimited. */
  readonly accessEndsAt?: string | null;
}
export interface AccessSummaryFacts {
  readonly active: readonly ActiveAccessGround[];
  readonly invitations: InvitationFunnel;
}

/**
 * Факты сводки доступа на момент `now`: все действующие основания и воронка приглашений. Сводку
 * читает только владелец по запросу, поэтому действующие основания и все приглашения читаются
 * целиком, без страниц.
 */
export async function readAccessSummary(
  prisma: AccountRightsPrismaClient,
  now: Date,
): Promise<AccessSummaryFacts> {
  const current = {
    revokedAt: null,
    startsAt: { lte: now },
  };
  const [enrollments, grants, invitations, timed] = await Promise.all([
    prisma.tariffAssignment.findMany({
      where: { ...current, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ accountId: "asc" }, { id: "asc" }],
    }),
    prisma.accessGrant.findMany({
      where: {
        ...current,
        enrollmentId: null,
        source: { in: [...standaloneGrantSources] },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      orderBy: [{ accountId: "asc" }, { id: "asc" }],
    }),
    prisma.invitation.findMany({
      select: {
        offerId: true,
        mode: true,
        expiresAt: true,
        claimedAt: true,
        claimedAccountId: true,
        redeemedAt: true,
        revokedAt: true,
      },
    }),
    readTimedEnrollmentAccess(prisma, now),
  ]);
  const purchaseOpened = invitations.filter(
    (row) => row.mode === "purchase" && row.redeemedAt !== null,
  );
  // Оплата по приглашению — назначение из платежа на тот же Offer, начатое после погашения.
  const payments = await prisma.tariffAssignment.findMany({
    where: {
      origin: "platform_payment",
      accountId: {
        in: purchaseOpened.flatMap((row) =>
          row.claimedAccountId === null ? [] : [row.claimedAccountId],
        ),
      },
    },
    select: { accountId: true, tierId: true, startsAt: true },
  });
  const states = invitations.map((row) => invitationState(row, now));
  return {
    active: [
      ...enrollments
        .filter((row) => {
          const access = timed.find((entry) => entry.id === row.id);
          return access === undefined || access.state === "active";
        })
        .map((row) => ({
          accountId: row.accountId,
          ground: enrollmentGround(row, now),
          accessEndsAt: timed.find((entry) => entry.id === row.id)?.endsAt,
        })),
      ...grants.map((row) => ({
        accountId: row.accountId,
        ground: grantGround(row, now),
      })),
    ],
    invitations: {
      issued: invitations.length,
      opened: invitations.filter((row) => row.claimedAt !== null).length,
      purchaseOpened: purchaseOpened.length,
      paid: purchaseOpened.filter((row) =>
        payments.some(
          (payment) =>
            payment.accountId === row.claimedAccountId &&
            payment.tierId === row.offerId &&
            row.redeemedAt !== null &&
            payment.startsAt >= row.redeemedAt,
        ),
      ).length,
      expired: states.filter((state) => state === "expired").length,
      revoked: states.filter((state) => state === "revoked").length,
    },
  };
}
