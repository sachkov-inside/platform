import { randomUUID } from "node:crypto";
import { z } from "zod";


import { contractDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import {
  Prisma,
  type TelegramMembershipPrisma,
  type TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import {
  COMMUNITY_CONTRACT_VERSION,
  accessAllows,
  communityAccessFor,
  communityAccessSchema,
  communitySetSchema,
  sameAccess,
  type CommunityAccess,
  type CommunityBinding,
} from "../../domain/community-entitlement.js";
import type { TelegramAccountLinks } from "../../facets/telegram-account-links/telegram-account-links.js";
import { lockCommunityWork } from "../../infrastructure/community-lock.js";

export interface CommunityProjectionDependencies {
  readonly prisma: TelegramMembershipPrismaClient;
  readonly grants: Pick<AccessGrants, "resolveCapabilities">;
  readonly links: Pick<TelegramAccountLinks, "readBinding">;
}

export type CommunityProjectionResult =
  | {
      readonly ok: true;
      readonly entitlementRevision: number;
      readonly issued: readonly string[];
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: "invalid_input" | "unavailable" };
    };

type OperationPurpose = "apply" | "cleanup";

const linkChangedRowsSchema = z.array(
  z.object({ account_id: z.uuid() }).strict(),
);

/**
 * Turns the Account's current combined access and verified Telegram link into one desired
 * community state, and records the commands that must reach the provider. It reads only
 * public facets, never writes access, and never treats a Telegram observation as a grant.
 */
export async function projectCommunityEntitlement(
  dependencies: CommunityProjectionDependencies,
  accountId: string,
  now: Date,
): Promise<CommunityProjectionResult> {
  if (!z.uuid().safeParse(accountId).success) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const [capabilities, binding] = await Promise.all([
    dependencies.grants.resolveCapabilities(accountId),
    dependencies.links.readBinding({ accountId }),
  ]);
  if (!capabilities.ok || !binding.ok) {
    return { ok: false, error: { code: "unavailable" } };
  }
  const access = communityAccessFor(capabilities.capabilities);
  const current = binding.binding;
  const currentIdentity = current?.telegramIdentityRef ?? null;
  const currentAccountRef = current?.accountRef ?? null;
  const currentLinkRef = current?.linkRef ?? null;
  const currentLinkRevision = current?.linkRevision ?? 0;

  try {
    return await dependencies.prisma.$transaction(async (transaction) => {
      await lockCommunityWork(transaction, accountId);
      const stored = await transaction.telegramCommunityDesiredState.findUnique(
        { where: { accountId } },
      );
      const storedAccess =
        stored === null ? null : communityAccessSchema.parse(stored.access);
      // A stale read never moves a projection backwards; the next pass corrects it.
      if (
        stored !== null &&
        (capabilities.revision < stored.accessRevision ||
          currentLinkRevision < stored.linkRevision)
      ) {
        return {
          ok: true as const,
          entitlementRevision: stored.entitlementRevision,
          issued: [],
        };
      }

      let entitlementRevision = stored?.entitlementRevision ?? 0;
      const issued: string[] = [];
      const emit = async (
        purpose: OperationPurpose,
        target: CommunityBinding,
        commandAccess: CommunityAccess,
      ): Promise<void> => {
        entitlementRevision += 1;
        const command = communitySetSchema.parse({
          access: commandAccess,
          binding: target,
          contractVersion: COMMUNITY_CONTRACT_VERSION,
          correlationRef: randomUUID(),
          entitlementRevision,
          issuedAt: now.toISOString(),
          operation: "entitlement.set",
          operationId: randomUUID(),
        });
        // An undelivered older command for the same recipient must never be sent after it.
        await transaction.telegramCommunityOperation.updateMany({
          where: {
            accountId,
            accountRef: target.accountRef,
            delivery: "pending",
          },
          data: { delivery: "superseded", updatedAt: now },
        });
        await transaction.telegramCommunityOperation.create({
          data: {
            access: command.access,
            accountId,
            accountRef: command.binding.accountRef,
            command,
            createdAt: now,
            delivery: "pending",
            entitlementRevision: command.entitlementRevision,
            identityRef: command.binding.telegramIdentityRef,
            issuedAt: new Date(command.issuedAt),
            linkRef: command.binding.linkRef,
            linkRevision: command.binding.linkRevision,
            nextAttemptAt: now,
            operationId: command.operationId,
            payloadDigest: contractDigest(command),
            purpose,
            updatedAt: now,
          },
        });
        issued.push(command.operationId);
      };

      // The identity we last told to admit is the only one we may later close.
      if (
        stored !== null &&
        stored.identityRef !== null &&
        stored.accountRef !== null &&
        stored.linkRef !== null &&
        stored.identityRef !== currentIdentity &&
        storedAccess !== null &&
        storedAccess.kind !== "denied"
      ) {
        await emit(
          "cleanup",
          {
            accountRef: stored.accountRef,
            linkRef: stored.linkRef,
            linkRevision: stored.linkRevision,
            telegramIdentityRef: stored.identityRef,
          },
          { kind: "denied" },
        );
      }

      const boundToCurrent =
        stored !== null &&
        stored.identityRef === currentIdentity &&
        stored.linkRevision === currentLinkRevision;
      const unchanged =
        boundToCurrent && storedAccess !== null && sameAccess(storedAccess, access);
      // A denial only goes to a recipient we previously told to admit.
      const announces =
        accessAllows(access, now) ||
        (boundToCurrent && storedAccess !== null && storedAccess.kind !== "denied");
      if (
        currentIdentity !== null &&
        currentAccountRef !== null &&
        currentLinkRef !== null &&
        announces &&
        !unchanged
      ) {
        await emit(
          "apply",
          {
            accountRef: currentAccountRef,
            linkRef: currentLinkRef,
            linkRevision: currentLinkRevision,
            telegramIdentityRef: currentIdentity,
          },
          access,
        );
      }

      const projection = {
        access,
        accessRevision: capabilities.revision,
        accountRef: currentAccountRef,
        entitlementRevision,
        identityRef: currentIdentity,
        latestOperationId: issued.at(-1) ?? stored?.latestOperationId ?? null,
        linkRef: currentLinkRef,
        linkRevision: currentLinkRevision,
        nextBoundary:
          capabilities.nextBoundary === null
            ? null
            : new Date(capabilities.nextBoundary),
        projectedAt: now,
      };
      await transaction.telegramCommunityDesiredState.upsert({
        where: { accountId },
        create: { accountId, ...projection },
        update: projection,
      });
      return { ok: true as const, entitlementRevision, issued };
    });
  } catch {
    return { ok: false, error: { code: "unavailable" } };
  }
}

/** Accounts whose verified link moved since their last projection, plus first links. */
export async function readLinkChangedAccounts(
  prisma: TelegramMembershipPrisma,
  limit: number,
): Promise<readonly string[]> {
  // Filtering in the database, not after a page: an Account behind on its link
  // revision must never be crowded out of the window by already projected ones.
  const rows = await prisma.$queryRaw(Prisma.sql`
    select link.account_id::text as account_id
    from telegram_membership.account_link_states as link
    left join telegram_membership.community_desired_states as desired
      on desired.account_id = link.account_id
    where desired.account_id is null or desired.link_revision <> link.revision
    order by link.updated_at asc
    limit ${limit}
  `);
  return linkChangedRowsSchema.parse(rows).map((row) => row.account_id);
}
