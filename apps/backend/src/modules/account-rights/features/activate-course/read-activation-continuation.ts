import { z } from "zod";
import type {
  AccountRightsPrismaClient,
  AccountRightsPrisma,
} from "../../infrastructure/prisma.js";
import {
  activationEvidenceSchema,
  activationOutcomeSchema,
} from "../../domain/course-activation.js";

/** A URL selects an attempt; only the current binding can authorize its Account-scoped result. */
export async function readActivationContinuation(
  prisma: Pick<
    AccountRightsPrisma,
    "activationAttempt" | "activationRule" | "productAccess" | "accessReceipt"
  >,
  attemptId: string,
  accountId: string,
  identityRef: string | null,
  now: Date,
  binding?: {
    accountRef: string | null;
    linkRef: string;
    linkRevision: number;
  },
) {
  if (!z.uuid().safeParse(attemptId).success)
    return { state: "expired" } as const;
  const attempt = await prisma.activationAttempt.findUnique({
    where: { id: attemptId },
  });
  if (attempt === null || attempt.expiresAt <= now)
    return { state: "expired" } as const;
  if (identityRef === null)
    return {
      state: "link_required",
      ruleId: attempt.ruleId,
      ruleRevision: attempt.ruleRevision,
    } as const;
  if (
    attempt.identityRef !== identityRef ||
    (attempt.accountId !== null && attempt.accountId !== accountId)
  )
    return { state: "identity_conflict" } as const;
  const rule = await prisma.activationRule.findUnique({
    where: { id: attempt.ruleId },
  });
  // An attempt selects an immutable rule revision, never the replacement Product of an edited rule.
  if (rule?.productId == null || rule.revision !== attempt.ruleRevision)
    return { state: "unavailable" } as const;
  const result = activationOutcomeSchema.parse(attempt.result);
  let active = false;
  if (
    result.state === "active" ||
    result.state === "already_active" ||
    result.state === "pending_review"
  ) {
    if (typeof binding?.accountRef !== "string")
      return { state: "identity_conflict" } as const;
    const receipt = await prisma.accessReceipt.findFirst({
      where: {
        scope: "source-evidence",
        AND: [
          { payload: { path: ["attemptId"], equals: attemptId } },
          { payload: { path: ["decision"], equals: "member" } },
          { payload: { path: ["accountRef"], equals: binding.accountRef } },
          { payload: { path: ["identityRef"], equals: identityRef } },
          { payload: { path: ["linkRef"], equals: binding.linkRef } },
          { payload: { path: ["linkRevision"], equals: binding.linkRevision } },
        ],
      },
      select: { payload: true },
    });
    const evidence = activationEvidenceSchema.safeParse(receipt?.payload);
    if (!evidence.success || evidence.data.decision !== "member")
      return { state: "identity_conflict" } as const;
    const access = await prisma.productAccess.findUnique({
      where: { accountId_productId: { accountId, productId: rule.productId } },
    });
    active = access?.revokedAt === null;
  }
  return {
    state: active ? "active" : "pending",
    ruleId: attempt.ruleId,
    ruleRevision: attempt.ruleRevision,
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
        ruleRevision: attempt.ruleRevision,
      };
}
