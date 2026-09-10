import { randomUUID } from "node:crypto";

import { contractDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import type {
  TelegramMembershipPrisma,
  TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import {
  COMMUNITY_CONTRACT_VERSION,
  DISPATCH_CONTRACT_VERSION,
  PERMIT_LIFETIME_MS,
  accessAllows,
  communityAccessFor,
  communityAccessSchema,
  dispatchErrorSchema,
  dispatchResultSchema,
  type DispatchAuthorizeRequest,
  type DispatchDecision,
  type DispatchDenialReason,
  type DispatchError,
  type DispatchResult,
} from "../../domain/community-entitlement.js";
import type { TelegramAccountLinks } from "../../facets/telegram-account-links/telegram-account-links.js";
import { lockCommunityWork } from "../../infrastructure/community-lock.js";
import { hasNewerCommand } from "../../shared/newer-community-command.js";

export interface CommunityAuthorizationDependencies {
  readonly prisma: TelegramMembershipPrismaClient;
  readonly grants: Pick<AccessGrants, "resolveCapabilities">;
  readonly links: Pick<TelegramAccountLinks, "readBinding">;
}

export type CommunityAuthorizationOutcome =
  | { readonly ok: true; readonly result: DispatchResult }
  | { readonly ok: false; readonly error: DispatchError };

/**
 * Answers Telegram's preflight before one external community effect. It re-reads the
 * current combined access and the current verified link instead of trusting the queued
 * command, so a lapsed, revoked or re-bound right can never authorise a stale effect.
 * The permit is a short-lived freshness statement; the effect ledger stays with Telegram.
 */
export async function authorizeCommunityDispatch(
  dependencies: CommunityAuthorizationDependencies,
  input: DispatchAuthorizeRequest,
  now: Date,
): Promise<CommunityAuthorizationOutcome> {
  const requestDigest = contractDigest(input);
  const decided = (decision: DispatchDecision): CommunityAuthorizationOutcome => ({
    ok: true,
    result: dispatchResultSchema.parse({
      attemptId: input.attemptId,
      contractVersion: DISPATCH_CONTRACT_VERSION,
      decision,
      dispatchId: input.dispatchId,
      operation: "dispatch.result",
      operationId: input.operationId,
    }),
  });
  const denied = (reason: DispatchDenialReason) =>
    decided({ reason, status: "denied" });
  const failed = (
    error: DispatchError["error"],
  ): CommunityAuthorizationOutcome => ({
    ok: false,
    error: dispatchErrorSchema.parse({
      contractVersion: DISPATCH_CONTRACT_VERSION,
      error,
      operation: "dispatch.error",
      operationId: input.operationId,
    }),
  });

  // Only community effects belong to this owner; a notice keeps its own facet.
  if (
    input.dispatchContractVersion !== COMMUNITY_CONTRACT_VERSION ||
    input.effect === "notice.send"
  ) {
    return denied("effect_conflict");
  }

  try {
    return await dependencies.prisma.$transaction(async (transaction) => {
      await lockCommunityWork(transaction, `authorize:${input.operationId}`);
      const replay =
        await transaction.telegramCommunityAuthorization.findUnique({
          where: { operationId: input.operationId },
        });
      if (replay !== null) {
        // The same authorization returns its original answer, including its deadline.
        if (replay.digest !== requestDigest) return failed("operation_conflict");
        const stored = dispatchResultSchema.safeParse(replay.response);
        return stored.success
          ? { ok: true as const, result: stored.data }
          : failed("unavailable");
      }

      const decision = await decide(
        dependencies,
        transaction,
        input,
        now,
        denied,
        decided,
      );
      // An unavailable answer is a transient failure, not a decision: storing it would
      // make every later replay of this operationId return it forever.
      if (decision.ok && decision.result.decision.status !== "unavailable") {
        await transaction.telegramCommunityAuthorization.create({
          data: {
            attemptId: input.attemptId,
            createdAt: now,
            digest: requestDigest,
            dispatchId: input.dispatchId,
            effect: input.effect,
            effectRef: input.effectRef,
            operationId: input.operationId,
            response: decision.result,
          },
        });
      }
      return decision;
    });
  } catch {
    return decided({ status: "unavailable" });
  }
}

async function decide(
  dependencies: CommunityAuthorizationDependencies,
  transaction: TelegramMembershipPrisma,
  input: DispatchAuthorizeRequest,
  now: Date,
  denied: (reason: DispatchDenialReason) => CommunityAuthorizationOutcome,
  decided: (decision: DispatchDecision) => CommunityAuthorizationOutcome,
): Promise<CommunityAuthorizationOutcome> {
  const operation = await transaction.telegramCommunityOperation.findUnique({
    where: { operationId: input.dispatchId },
  });
  if (operation === null) return denied("not_found");
  if (operation.payloadDigest !== input.payloadDigest) {
    return denied("payload_conflict");
  }
  const [capabilities, binding] = await Promise.all([
    dependencies.grants.resolveCapabilities(operation.accountId),
    dependencies.links.readBinding({ accountId: operation.accountId }),
  ]);
  if (!capabilities.ok || !binding.ok) return decided({ status: "unavailable" });
  const currentAccess = communityAccessFor(capabilities.capabilities);
  const commandAccess = communityAccessSchema.parse(operation.access);
  const current = binding.binding;
  const bindsCurrentIdentity =
    current?.telegramIdentityRef === operation.identityRef &&
    current?.accountRef === operation.accountRef &&
    current?.linkRef === operation.linkRef &&
    current?.linkRevision === operation.linkRevision;

  if (input.effect === "community.ensure_absence") {
    const targetsHistory =
      operation.purpose === "cleanup" &&
      current?.telegramIdentityRef !== operation.identityRef;
    if (targetsHistory) {
      // Only this Account's own history may close that identity, and only without a transfer.
      const owners = await transaction.telegramLinkTransaction.findMany({
        where: {
          providerIdentityRef: operation.identityRef,
          status: "linked",
        },
        select: { accountId: true },
      });
      if (owners.some((owner) => owner.accountId !== operation.accountId)) {
        return denied("binding_conflict");
      }
      return decided(permit(now));
    }
    if (!bindsCurrentIdentity) return denied("binding_conflict");
    if (await hasNewerCommand(transaction, operation)) return denied("superseded");
    // An expired reason never removes a member who already has another live one.
    if (accessAllows(currentAccess, now)) return denied("superseded");
    return decided(permit(now));
  }

  if (commandAccess.kind === "denied") return denied("effect_conflict");
  // The recipient is checked before the revision: a command whose verified link has
  // moved is a binding conflict, whether or not a newer command was issued yet.
  if (!bindsCurrentIdentity) return denied("binding_conflict");
  if (await hasNewerCommand(transaction, operation)) return denied("superseded");
  if (!accessAllows(currentAccess, now)) {
    return denied(
      commandAccess.kind === "finite" &&
        Date.parse(commandAccess.validUntil) <= now.getTime()
        ? "expired"
        : "superseded",
    );
  }
  const deadline =
    currentAccess.kind === "finite"
      ? Math.min(
          now.getTime() + PERMIT_LIFETIME_MS,
          Date.parse(currentAccess.validUntil),
        )
      : now.getTime() + PERMIT_LIFETIME_MS;
  if (deadline <= now.getTime()) return denied("expired");
  return decided(permit(now, deadline));
}

function permit(now: Date, deadline?: number): DispatchDecision {
  return {
    permitRef: randomUUID(),
    status: "allowed",
    validUntil: new Date(deadline ?? now.getTime() + PERMIT_LIFETIME_MS).toISOString(),
  };
}
