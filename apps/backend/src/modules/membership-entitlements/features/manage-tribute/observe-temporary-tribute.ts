import type { MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import { MAX_EVIDENCE_VALIDITY_MS, type ObservedMembershipEvidence } from "../accept-evidence/validate-membership-evidence.js";
import { tributeStateSchema } from "../../domain/tribute-source.js";
import { projectTributeSource } from "../../shared/tribute-source.js";

/** Called in accepted evidence order under binding/source/account locks, never from latest projection polling. */
export async function observeTemporaryTribute(tx: MembershipEntitlementsPrisma, sourceIds: readonly string[],
  accountId: string, evidence: ObservedMembershipEvidence, now: Date) {
  for (const id of sourceIds) {
    const source = await tx.sourceEntitlement.findUniqueOrThrow({ where: { id } });
    const parsed = tributeStateSchema.safeParse(source.tributeState);
    if (!parsed.success || source.accountId !== accountId || source.identityRef !== evidence.telegramIdentityRef || source.revokedAt !== null) continue;
    const state = parsed.data;
    if (state.mode !== "temporary_membership" || state.observation === "source_ended") continue;
    if (state.observationVersion !== null && BigInt(state.observationVersion) >= BigInt(evidence.evidenceVersion)) continue;
    const policy = await tx.tributePolicy.findUnique({ where: { id: source.sourcePolicyRef } });
    const cutoff = Math.min(Date.parse(state.endsAt), policy?.temporaryUntil?.getTime() ?? now.getTime());
    const validUntil = Math.min(Date.parse(evidence.validUntil), Date.parse(evidence.checkedAt) + MAX_EVIDENCE_VALIDITY_MS, cutoff);
    const member = evidence.decision === "member" && policy?.enabled === true && validUntil > now.getTime();
    const next = tributeStateSchema.parse({ ...state,
      observation: evidence.decision === "not_member" ? "source_ended" : member ? "member" : "observation_stale",
      observedUntil: new Date(validUntil).toISOString(), observationVersion: String(evidence.evidenceVersion) });
    const saved = await tx.sourceEntitlement.update({ where: { id }, data: { tributeState: next,
      revision: { increment: 1 }, checkedAt: new Date(evidence.checkedAt), evidence: { method: "accepted_membership", evidence } } });
    const result = await projectTributeSource(tx, saved, next, accountId, null, evidence.decision === "not_member"
      ? "Подтверждён выход из прежнего источника Tribute" : "Обновлено временное подтверждение Tribute", now);
    if (!result.ok) throw new Error("Locked temporary source projection failed");
  }
}
