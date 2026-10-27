import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { COMMUNITY_OVERDUE_MS } from "../../domain/community-entitlement.js";

/** The largest problem set one read answers; a larger set is refused, never cut. */
export const COMMUNITY_PROBLEM_ACCOUNTS_LIMIT = 50_000;

export type CommunityProblemAccountsResult =
  | { readonly ok: true; readonly accountIds: readonly string[] }
  | { readonly ok: false };

const rowsSchema = z.array(z.object({ accountId: z.uuid() }));

/**
 * Accounts whose latest community operation (the highest entitlement revision) needs the
 * operator, ascending: the provider rejected it, accepted it and then reported `failed`, or it is
 * overdue by the rule of `readCommunityBacklog`: older than `COMMUNITY_OVERDUE_MS` and still
 * undelivered or undecided, except a voluntary join that a fresh, successful poll still observes
 * as pending. An undecided operation without such an observation is a problem, never «no problem».
 * An earlier failure that a later operation replaced is not.
 */
export async function listCommunityProblemAccounts(
  prisma: TelegramMembershipPrismaClient,
  now: Date,
): Promise<CommunityProblemAccountsResult> {
  const overdueBefore = new Date(now.getTime() - COMMUNITY_OVERDUE_MS);
  try {
    const rows = rowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
        SELECT latest.account_id::text AS "accountId"
        FROM (
          SELECT DISTINCT ON (operation.account_id) operation.*
          FROM telegram_membership.community_operations operation
          ORDER BY operation.account_id, operation.entitlement_revision DESC
        ) latest
        WHERE latest.delivery = 'rejected'
          OR (latest.delivery = 'accepted' AND latest.result_status = 'failed')
          OR (
            latest.created_at <= ${overdueBefore}
            AND (
              latest.delivery = 'pending'
              OR (
                latest.delivery = 'accepted'
                AND latest.result_status IS DISTINCT FROM 'applied'
                AND latest.result_status IS DISTINCT FROM 'superseded'
                -- An unknown fact never grants the exemption: NULL compares as false here.
                AND NOT COALESCE(
                  latest.result_status = 'waiting_for_join'
                  AND latest.observed_membership = 'not_member'
                  AND latest.error_code IS NULL
                  AND latest.polled_at > ${overdueBefore},
                  false
                )
              )
            )
          )
        ORDER BY 1
        LIMIT ${COMMUNITY_PROBLEM_ACCOUNTS_LIMIT + 1}
      `),
    );
    if (rows.length > COMMUNITY_PROBLEM_ACCOUNTS_LIMIT)
      return dependencyFailure(
        {
          module: "telegram-membership",
          operation: "listCommunityProblemAccounts",
        },
        new RangeError("Community problem Account set exceeds its bound"),
        { ok: false } as const,
      );
    return { ok: true, accountIds: rows.map((row) => row.accountId) };
  } catch (error) {
    return dependencyFailure(
      {
        module: "telegram-membership",
        operation: "listCommunityProblemAccounts",
      },
      error,
      { ok: false } as const,
    );
  }
}
