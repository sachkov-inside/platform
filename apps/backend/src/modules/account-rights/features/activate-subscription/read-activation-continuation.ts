import { z } from "zod";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import { activationOutcomeSchema } from "../../domain/subscription-activation.js";

/** A URL selects an attempt; only the current binding can authorize its Account-scoped result. */
export async function readActivationContinuation(
  prisma: Pick<AccountRightsPrismaClient, "activationAttempt">,
  attemptId: string,
  accountId: string,
  identityRef: string | null,
  now: Date,
) {
  if (!z.uuid().safeParse(attemptId).success)
    return { state: "expired" } as const;
  const attempt = await prisma.activationAttempt.findUnique({
    where: { id: attemptId },
  });
  if (attempt === null || attempt.expiresAt <= now)
    return { state: "expired" } as const;
  if (identityRef === null)
    return { state: "link_required", ruleId: attempt.ruleId } as const;
  if (
    attempt.identityRef !== identityRef ||
    (attempt.accountId !== null && attempt.accountId !== accountId)
  )
    return { state: "identity_conflict" } as const;
  const result = activationOutcomeSchema.parse(attempt.result);
  return {
    state:
      result.state === "active" || result.state === "already_active"
        ? "active"
        : "pending",
    ruleId: attempt.ruleId,
  } as const;
}

/** Public navigation metadata only. Never project the identity, Account, binding, proof, or grant. */
export async function readActivationIntent(
  prisma: Pick<AccountRightsPrismaClient, "activationAttempt">,
  attemptId: string,
  now: Date,
) {
  if (!z.uuid().safeParse(attemptId).success) return null;
  const attempt = await prisma.activationAttempt.findUnique({
    where: { id: attemptId },
  });
  return attempt === null
    ? null
    : {
        state:
          attempt.expiresAt <= now ? ("expired" as const) : ("ready" as const),
        ruleId: attempt.ruleId,
      };
}
