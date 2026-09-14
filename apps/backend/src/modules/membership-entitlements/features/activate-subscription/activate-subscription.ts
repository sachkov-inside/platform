import { courseSourceRef } from "../../domain/source-identity.js";
import { randomUUID } from "node:crypto";
import { lockTelegramAccountBinding } from "../../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import { accessFailure } from "../../domain/access-grant.js";
import { tierSnapshotSchema } from "../../domain/subscription-enrollment.js";
import { ACTIVATION_CONTRACT_VERSION, beginActivationSchema, activationEvidenceSchema, activationOutcomeSchema, type ActivationBindings, type ActivationOutcome } from "../../domain/subscription-activation.js";
import { assignEnrollmentInTransaction } from "../assign-enrollment/assign-enrollment.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";
const activationAttemptLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1000;
const sourceProofLifetimeMilliseconds = 5 * 60 * 1000;
export async function beginActivation(prisma: MembershipEntitlementsPrismaClient, input: unknown, now: Date) {
  const parsed = beginActivationSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  return prisma.$transaction(async tx => {
    await lockAccess(tx, `activation-attempt:${command.attemptId}`);
    await tx.activationAttempt.deleteMany({ where: { expiresAt: { lte: now } } });
    const rule = await tx.activationRule.findUnique({ where: { code: command.code } });
    if (rule === null || !rule.published || rule.startsAt > now || (rule.endsAt !== null && rule.endsAt <= now)) return accessFailure("policy_paused");
    const prior = await tx.activationAttempt.findUnique({ where: { id: command.attemptId } });
    if (prior !== null) return prior.identityRef === command.identityRef && prior.ruleId === rule.id
      ? { ok: true as const, value: activationOutcomeSchema.parse(prior.result) } : accessFailure("operation_conflict");
    const value: ActivationOutcome = { contractVersion: ACTIVATION_CONTRACT_VERSION, attemptId: command.attemptId, state: "needs_account", enrollment: null, rule: { id: rule.id, revision: rule.revision, sourceRef: rule.sourceRef } };
    await tx.activationAttempt.create({ data: { id: command.attemptId, identityRef: command.identityRef, ruleId: rule.id,
      ruleRevision: rule.revision, result: value, expiresAt: new Date(now.getTime() + activationAttemptLifetimeMilliseconds) } });
    return { ok: true as const, value };
  });
}
/** Exact receipt replay is available only to the authenticated source authority. It cannot create rights. */
export async function readActivationReceipt(prisma: MembershipEntitlementsPrismaClient, input: unknown) {
  const parsed = activationEvidenceSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const receipt = await prisma.accessReceipt.findUnique({ where: { scope_operationId: { scope: "source-evidence", operationId: parsed.data.evidenceRef } } });
  if (receipt === null) return null;
  return receipt.fingerprint === accessFingerprint(parsed.data)
    ? { ok: true as const, value: activationOutcomeSchema.parse(receipt.result) } : accessFailure("operation_conflict");
}
/** The caller holds the matching catalog revision; proof is accepted only from the separate source authority. */
export async function activateSubscription(prisma: MembershipEntitlementsPrismaClient, bindings: ActivationBindings, input: unknown, tierInput: unknown, now: Date) {
  const parsed = activationEvidenceSchema.safeParse(input); const tier = tierSnapshotSchema.safeParse(tierInput);
  if (!parsed.success || !tier.success) return accessFailure("invalid_input");
  const evidence = parsed.data;
  const checkedAt = new Date(evidence.checkedAt); const validUntil = new Date(evidence.validUntil);
  if (checkedAt > now || now.getTime() - checkedAt.getTime() > sourceProofLifetimeMilliseconds || validUntil <= now || validUntil.getTime() - checkedAt.getTime() > sourceProofLifetimeMilliseconds) return accessFailure("source_not_confirmed");
  const linked = await bindings.find({ accountRef: evidence.accountRef });
  if (!linked.ok) return accessFailure("unavailable");
  if (linked.link === null || linked.link.telegramIdentityRef !== evidence.identityRef) return accessFailure("identity_conflict");
  const accountId = linked.link.accountId;
  return prisma.$transaction(async tx => {
    const fingerprint = accessFingerprint(evidence);
    const receipt = await readAccessReceipt(tx, "source-evidence", evidence.evidenceRef);
    if (receipt !== null) return receipt.fingerprint === fingerprint ? { ok: true as const, value: activationOutcomeSchema.parse(receipt.result) } : accessFailure("operation_conflict");
    await lockAccess(tx, `activation-rule:${evidence.ruleId}`);
    await lockAccess(tx, `activation-attempt:${evidence.attemptId}`);
    const rule = await tx.activationRule.findUnique({ where: { id: evidence.ruleId } });
    if (rule === null || !rule.published || rule.startsAt > now || (rule.endsAt !== null && rule.endsAt <= now)) return accessFailure("policy_paused");
    if (rule.revision !== evidence.ruleRevision || rule.sourceRef !== evidence.sourceRef || rule.tierId !== tier.data.id || rule.tierRevision !== tier.data.revision) return accessFailure("revision_conflict");
    const attempt = await tx.activationAttempt.findUnique({ where: { id: evidence.attemptId } });
    if (attempt === null || attempt.expiresAt <= now || attempt.identityRef !== evidence.identityRef || attempt.ruleId !== rule.id || attempt.ruleRevision !== rule.revision) return accessFailure("revision_conflict");
    await lockTelegramAccountBinding(tx, accountId);
    const binding = await bindings.readBinding({ accountId });
    if (!binding.ok) return accessFailure("unavailable");
    if (binding.binding === null || binding.binding.telegramIdentityRef !== evidence.identityRef || binding.binding.accountRef !== evidence.accountRef || binding.binding.linkRef !== evidence.linkRef || binding.binding.linkRevision !== evidence.linkRevision) return accessFailure("identity_conflict");
    let value: ActivationOutcome = { contractVersion: ACTIVATION_CONTRACT_VERSION, attemptId: evidence.attemptId,
      state: evidence.decision === "unavailable" ? "unavailable" : "rejected", enrollment: null };
    if (evidence.decision === "member") {
      const sourceRef = courseSourceRef(rule.sourceRef, evidence.identityRef);
      const result = await assignEnrollmentInTransaction(tx, null, { operationId: evidence.evidenceRef, accountId,
        origin: "course", sourceRef, tierId: tier.data.id, tierRevision: tier.data.revision,
        terms: { startsAt: now.toISOString(), endsAt: null, endPolicy: "fixed" }, billingRef: null, reason: "Verified course source activation" }, tier.data, now);
      if (!result.ok) return result;
      value = { contractVersion: ACTIVATION_CONTRACT_VERSION, attemptId: evidence.attemptId,
        state: result.value.state === "revoked" ? "pending_review" : result.value.revision > 1 ? "already_active" : "active", enrollment: result.value };
      const source = await tx.sourceEntitlement.findUnique({ where: { origin_sourceRef: { origin: "course", sourceRef } } });
      if (source !== null && source.accountId !== null && source.accountId !== accountId) throw new Error("Source identity changed during activation");
      await tx.sourceEntitlement.upsert({ where: { origin_sourceRef: { origin: "course", sourceRef } },
        create: { id: randomUUID(), origin: "course", sourceRef, sourcePolicyRef: rule.sourceRef, identityRef: evidence.identityRef,
          accountId, enrollmentId: result.value.id, revision: 1, evidence, checkedAt },
        update: { accountId, enrollmentId: result.value.id, evidence, checkedAt } });
    }
    await tx.activationAttempt.update({ where: { id: attempt.id }, data: { accountId, result: value } });
    await tx.accessReceipt.create({ data: { scope: "source-evidence", operationId: evidence.evidenceRef, fingerprint,
      payload: evidence, result: value, createdAt: now } });
    return { ok: true as const, value };
  });
}
