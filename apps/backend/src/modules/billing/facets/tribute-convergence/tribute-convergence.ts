import { z } from "zod";
import { lockBillingPricing, type BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { tierOpenForAssignment } from "../../shared/tier-composition.js";
import { type TributeSources, tierSnapshotSchema, saveTributePolicySchema } from "../../../membership-entitlements/index.js";

/** Catalog eligibility and source assignment share the existing pricing lock. */
export class TributeConvergence {
  constructor(private readonly prisma: BillingPrismaClient, private readonly sources: TributeSources) {}
  status(actorId: string, page = 0) { return this.sources.status(actorId, page); }
  dismissImport(actorId: string, input: unknown) { return this.sources.dismissImport(actorId, input); }
  preview(actorId: string, input: unknown) { return this.sources.preview(actorId, input); }
  reconcile(actorId: string, input: unknown) { return this.sources.reconcile(actorId, input); }
  retryEvent(actorId: string, input: unknown) { return this.sources.retryEvent(actorId, input); }
  receive(raw: Buffer, input: unknown) { return this.sources.receive(raw, input); }
  async savePolicy(actorId: string, input: unknown) {
    const parsed = saveTributePolicySchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "invalid_input" as const } };
    return this.prisma.$transaction(async tx => {
      await lockBillingPricing(tx);
      const row = await tx.billingOffer.findUnique({ where: { id: parsed.data.tierId } });
      if (row === null || !tierOpenForAssignment(row)) return { ok: false as const, error: { code: "not_found" as const } };
      if (row.revision !== parsed.data.tierRevision) return { ok: false as const, error: { code: "revision_conflict" as const } };
      const tier = tierSnapshotSchema.parse({ id: row.id, revision: row.revision, name: row.name, benefits: row.benefits, contentScope: row.contentScope });
      return this.sources.savePolicy(actorId, input, tier);
    });
  }
  async apply(actorId: string, input: unknown) {
    return this.prisma.$transaction(async tx => {
      await lockBillingPricing(tx);
      const snapshots = await this.sources.previewTiers(actorId, input);
      if (!snapshots.ok) return snapshots;
      for (const tier of snapshots.value) {
        const current = await tx.billingOffer.findUnique({ where: { id: tier.id } });
        if (current === null || !tierOpenForAssignment(current)) return { ok: false as const, error: { code: "not_found" as const } };
        if (current.revision !== tier.revision) return { ok: false as const, error: { code: "revision_conflict" as const } };
      }
      return this.sources.apply(actorId, input);
    });
  }
  sweep(limit = 50) {
    return this.prisma.$transaction(async tx => {
      await lockBillingPricing(tx);
      const tiers = await tx.billingOffer.findMany({ where: { archived: false, availableForAssignment: true }, select: { id: true, benefits: true, contentScope: true, archived: true, availableForAssignment: true } });
      // Тариф без состава не назначается и сверкой: подтверждённый источник ждёт, пока состав задан.
      return this.sources.sweep(tiers.filter(tierOpenForAssignment).map(tier => z.uuid().parse(tier.id)), limit);
    });
  }
}
