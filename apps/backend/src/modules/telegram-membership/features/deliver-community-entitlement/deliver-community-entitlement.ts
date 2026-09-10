import type { TelegramMembershipPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  COMMUNITY_OVERDUE_MS,
  COMMUNITY_RECONCILIATION_INTERVAL_MS,
  COMMUNITY_RETRY_DELAYS_MS,
  communitySetSchema,
  type CommunityResult,
} from "../../domain/community-entitlement.js";
import { lockCommunityWork } from "../../infrastructure/community-lock.js";
import { hasNewerCommand } from "../../shared/newer-community-command.js";
import type {
  CommunityDeliveryOutcome,
  CommunityEntitlementProvider,
} from "../../ports/community-entitlement-provider.js";

export interface CommunityDeliveryDependencies {
  readonly prisma: TelegramMembershipPrismaClient;
  readonly provider: CommunityEntitlementProvider;
}

export interface CommunityDeliveryReport {
  readonly sent: number;
  readonly accepted: number;
  readonly rejected: number;
}

/** Only a lost answer is retried. A decided rejection is operator work, not a new attempt. */
function retryDelayMs(attempts: number): number {
  const index = Math.min(attempts, COMMUNITY_RETRY_DELAYS_MS.length - 1);
  return COMMUNITY_RETRY_DELAYS_MS[index] ?? 30_000;
}

/** What the provider actually reported, separate from our own delivery lifecycle. */
function observationFields(result: CommunityResult, now: Date) {
  return {
    errorCode: null,
    observedMembership: result.observedMembership,
    polledAt: now,
    result,
    resultAt: now,
    resultStatus: result.status,
    updatedAt: now,
  };
}

/**
 * Sends every desired state that has no durable acceptance yet. A repeat always reuses the
 * original operationId and payload, so a lost answer never becomes a second command.
 */
export async function deliverCommunityOperations(
  dependencies: CommunityDeliveryDependencies,
  limit: number,
  now: Date,
): Promise<CommunityDeliveryReport> {
  const due = await dependencies.prisma.telegramCommunityOperation.findMany({
    where: { delivery: "pending", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { operationId: "asc" }],
    take: limit,
  });
  let sent = 0;
  let accepted = 0;
  let rejected = 0;
  for (const row of due) {
    const command = communitySetSchema.safeParse(row.command);
    if (!command.success) {
      await dependencies.prisma.telegramCommunityOperation.update({
        where: { operationId: row.operationId },
        data: {
          delivery: "rejected",
          errorCode: "malformed",
          updatedAt: now,
        },
      });
      rejected += 1;
      continue;
    }
    const outcome = await dependencies.provider.set(command.data);
    sent += 1;
    const settled = await dependencies.prisma.$transaction(
      async (transaction) => {
        await lockCommunityWork(transaction, row.accountId);
        const current = await transaction.telegramCommunityOperation.findUnique(
          { where: { operationId: row.operationId } },
        );
        if (current === null) return "gone";
        // A newer projection may have superseded this command while it was in
        // flight. Its answer is still kept for the operator, but it stays superseded.
        if (current.delivery !== "pending") {
          if (outcome.kind === "result") {
            await transaction.telegramCommunityOperation.update({
              where: { operationId: row.operationId },
              data: observationFields(outcome.result, now),
            });
          }
          return "gone";
        }
        await transaction.telegramCommunityOperation.update({
          where: { operationId: row.operationId },
          data: settlement(outcome, current.attempts, now),
        });
        return outcome.kind === "result"
          ? "accepted"
          : outcome.kind === "error" && outcome.error !== "unavailable"
            ? "rejected"
            : "retry";
      },
    );
    if (settled === "accepted") accepted += 1;
    if (settled === "rejected") rejected += 1;
  }
  return { accepted, rejected, sent };
}

function settlement(
  outcome: CommunityDeliveryOutcome,
  attempts: number,
  now: Date,
) {
  if (outcome.kind === "result") {
    return {
      ...observationFields(outcome.result, now),
      attempts: attempts + 1,
      delivery: "accepted",
    };
  }
  if (outcome.kind === "error" && outcome.error !== "unavailable") {
    return {
      attempts: attempts + 1,
      delivery: "rejected",
      errorCode: outcome.error,
      updatedAt: now,
    };
  }
  return {
    attempts: attempts + 1,
    errorCode: outcome.kind === "error" ? outcome.error : "no_answer",
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
    updatedAt: now,
  };
}

/**
 * Asks the provider what actually happened to an accepted command. Telegram sends no
 * callback, so this poll is how an accepted intent becomes an observed application, and
 * how a member who left is noticed without any new entitlement revision.
 */
export async function pollCommunityOperations(
  dependencies: CommunityDeliveryDependencies,
  limit: number,
  now: Date,
): Promise<number> {
  const candidates =
    await dependencies.prisma.telegramCommunityOperation.findMany({
      where: {
        delivery: "accepted",
        resultStatus: { notIn: ["superseded", "failed"] },
        OR: [
          { polledAt: null },
          {
            polledAt: {
              lte: new Date(
                now.getTime() - COMMUNITY_RECONCILIATION_INTERVAL_MS,
              ),
            },
          },
        ],
      },
      orderBy: [{ polledAt: "asc" }, { operationId: "asc" }],
      take: limit,
    });
  let polled = 0;
  for (const row of candidates) {
    // Only the latest command for a recipient is reconciled. This is our own lifecycle
    // decision, so it never overwrites what the provider actually reported.
    if (await hasNewerCommand(dependencies.prisma, row)) {
      await dependencies.prisma.telegramCommunityOperation.update({
        where: { operationId: row.operationId },
        data: { delivery: "superseded", polledAt: now, updatedAt: now },
      });
      continue;
    }
    const command = communitySetSchema.safeParse(row.command);
    if (!command.success) continue;
    const outcome = await dependencies.provider.status(command.data);
    polled += 1;
    if (outcome.kind === "result") {
      await dependencies.prisma.telegramCommunityOperation.update({
        where: { operationId: row.operationId },
        data: observationFields(outcome.result, now),
      });
      continue;
    }
    await dependencies.prisma.telegramCommunityOperation.update({
      where: { operationId: row.operationId },
      data: {
        errorCode: outcome.kind === "error" ? outcome.error : "no_answer",
        polledAt: now,
        updatedAt: now,
      },
    });
  }
  return polled;
}

export interface CommunityBacklog {
  readonly pending: number;
  readonly unapplied: number;
  readonly rejected: number;
  readonly overdue: number;
}

/** What an operator must look at: undelivered, undecided or refused community work. */
export async function readCommunityBacklog(
  prisma: TelegramMembershipPrismaClient,
  now: Date,
): Promise<CommunityBacklog> {
  const overdueBefore = new Date(now.getTime() - COMMUNITY_OVERDUE_MS);
  const [pending, unapplied, rejected, overdue] = await Promise.all([
    prisma.telegramCommunityOperation.count({ where: { delivery: "pending" } }),
    prisma.telegramCommunityOperation.count({
      where: {
        delivery: "accepted",
        resultStatus: { notIn: ["applied", "superseded", "failed"] },
      },
    }),
    prisma.telegramCommunityOperation.count({
      where: { delivery: "rejected" },
    }),
    prisma.telegramCommunityOperation.count({
      where: {
        createdAt: { lte: overdueBefore },
        OR: [
          { delivery: "pending" },
          {
            delivery: "accepted",
            resultStatus: { notIn: ["applied", "superseded", "failed"] },
          },
        ],
      },
    }),
  ]);
  return { overdue, pending, rejected, unapplied };
}
