import { lockTelegramAccountBinding } from "../../../../infrastructure/prisma/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { ownSubscriptionAccessQuerySchema, activationEvidenceSchema, type AccessGrants, type ActivationBindings } from "../../../membership-entitlements/index.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { bindingLookupQuerySchema, bindingSnapshotSchema } from "../../../membership-entitlements/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
export class SubscriptionActivation {
  constructor(private readonly dependencies: { prisma: BillingPrismaClient; grants: AccessGrants; bindings: ActivationBindings & Pick<TelegramAccountLinks, "findCurrentByIdentity">; readAdmission: (accountId: string) => Promise<{ admissionRestriction: "none" | "moderation" | "external_unknown" | null; state: "checking" | "no_access" | "moderation_blocked" | "ready" }> }) {}
  /** An observation, not a reservation: evidence and own-access still validate the exact binding. */
  async lookupBinding(input: unknown) {
    const parsed = bindingLookupQuerySchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "invalid_input" as const } };
    try {
      const result = await this.dependencies.bindings.findCurrentByIdentity(parsed.data.identityRef);
      if (!result.ok) return { ok: false as const, error: { code: "unavailable" as const } };
      if (result.state === "ambiguous") return { ok: false as const, error: { code: "identity_conflict" as const } };
      if (result.state === "not_found") return { ok: true as const, value: { contractVersion: parsed.data.contractVersion, state: "unlinked" as const } };
      // Explicit projection keeps the internal Account UUID outside the source-authority contract.
      const binding = bindingSnapshotSchema.safeParse({ accountRef: result.recipient.accountRef,
        identityRef: result.recipient.identityRef, linkRef: result.recipient.linkRef, linkRevision: result.recipient.linkRevision });
      if (!binding.success) return { ok: false as const, error: { code: "unavailable" as const } };
      if (binding.data.identityRef !== parsed.data.identityRef) return { ok: false as const, error: { code: "identity_conflict" as const } };
      return { ok: true as const, value: { contractVersion: parsed.data.contractVersion, state: "linked" as const, binding: binding.data } };
    } catch { return { ok: false as const, error: { code: "unavailable" as const } }; }
  }
  async readOwn(input: unknown) {
    const parsed = ownSubscriptionAccessQuerySchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "invalid_input" as const } };
    const query = parsed.data; const linked = await this.dependencies.bindings.find({ accountRef: query.accountRef });
    if (!linked.ok) return { ok: false as const, error: { code: "unavailable" as const } };
    if (linked.link === null || linked.link.telegramIdentityRef !== query.identityRef) return { ok: false as const, error: { code: "identity_conflict" as const } };
    const accountId = linked.link.accountId;
    return this.dependencies.prisma.$transaction(async tx => {
      await lockTelegramAccountBinding(tx, accountId);
      const current = await this.dependencies.bindings.readBinding({ accountId });
      if (!current.ok || current.binding === null || current.binding.linkRef !== query.linkRef || current.binding.linkRevision !== query.linkRevision || current.binding.telegramIdentityRef !== query.identityRef)
        return { ok: false as const, error: { code: "identity_conflict" as const } };
      const [enrollments, access] = await Promise.all([this.dependencies.grants.readOwnEnrollments(accountId), this.dependencies.grants.readOwnAccess(accountId)]);
      if (!enrollments.ok || !access.ok) return { ok: false as const, error: { code: "unavailable" as const } };
      return { ok: true as const, value: { contractVersion: query.contractVersion, enrollments: enrollments.value, grounds: access.value.grounds, admission: await this.dependencies.readAdmission(accountId) } };
    });
  }
  begin(input: unknown) { return this.dependencies.grants.beginActivation(input); }
  async accept(input: unknown) {
    const parsed = activationEvidenceSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "invalid_input" as const } };
    const receipt = await this.dependencies.grants.readActivationReceipt(parsed.data);
    if (receipt !== null) return receipt;
    const rule = await this.dependencies.grants.readActivationRule(parsed.data.ruleId);
    if (rule === null) return { ok: false as const, error: { code: "not_found" as const } };
    return this.dependencies.prisma.$transaction(async tx => {
      await lockPricing(tx);
      const row = await tx.billingOffer.findUnique({ where: { id: rule.tierId } });
      if (row === null || row.archived || !row.availableForAssignment) return { ok: false as const, error: { code: "not_found" as const } };
      if (row.revision !== rule.tierRevision) return { ok: false as const, error: { code: "revision_conflict" as const } };
      return this.dependencies.grants.activateSubscription(this.dependencies.bindings, parsed.data, {
        id: row.id, revision: row.revision, name: row.name, benefits: row.benefits, contentScope: row.contentScope,
      });
    });
  }
}
