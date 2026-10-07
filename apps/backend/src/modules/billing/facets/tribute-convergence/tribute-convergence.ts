import { z } from "zod";
import {
  lockBillingPricing,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { tierOpenForAssignment } from "../../shared/tier-composition.js";
import {
  type TributeSources,
  tierSnapshotSchema,
  saveTributePolicySchema,
} from "../../../membership-entitlements/index.js";

/** Catalog eligibility and source assignment share the existing pricing lock. */
export class TributeConvergence {
  constructor(
    private readonly prisma: BillingPrismaClient,
    private readonly sources: TributeSources,
  ) {}
  status(actorId: string, page = 0) {
    return this.sources.status(actorId, page);
  }
  dismissImport(actorId: string, input: unknown) {
    return this.sources.dismissImport(actorId, input);
  }
  preview(actorId: string, input: unknown) {
    return this.sources.preview(actorId, input);
  }
  reconcile(actorId: string, input: unknown) {
    return this.sources.reconcile(actorId, input);
  }
  retryEvent(actorId: string, input: unknown) {
    return this.sources.retryEvent(actorId, input);
  }
  receive(raw: Buffer, input: unknown) {
    return this.sources.receive(raw, input);
  }
  async savePolicy(actorId: string, input: unknown) {
    const parsed = saveTributePolicySchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    const prepared = await this.sources.preparePolicy(actorId, input);
    if (!prepared.ok) return prepared;
    return this.prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      const row = await tx.billingOffer.findUnique({
        where: { id: parsed.data.tierId },
      });
      if (row === null || !tierOpenForAssignment(row))
        return { ok: false as const, error: { code: "not_found" as const } };
      if (row.revision !== parsed.data.tierRevision)
        return {
          ok: false as const,
          error: { code: "revision_conflict" as const },
        };
      const tier = tierSnapshotSchema.parse({
        id: row.id,
        revision: row.revision,
        name: row.name,
        benefits: row.benefits,
        contentScope: row.contentScope,
      });
      return prepared.value(tx, tier);
    });
  }
  async apply(actorId: string, input: unknown) {
    const prepared = await this.sources.prepareApply(actorId, input);
    if (!prepared.ok) return prepared;
    return this.prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      for (const tier of prepared.value.tiers) {
        const current = await tx.billingOffer.findUnique({
          where: { id: tier.id },
        });
        if (current === null || !tierOpenForAssignment(current))
          return { ok: false as const, error: { code: "not_found" as const } };
        if (current.revision !== tier.revision)
          return {
            ok: false as const,
            error: { code: "revision_conflict" as const },
          };
      }
      return prepared.value.apply(tx);
    });
  }
  async sweep(limit = 50) {
    const candidates = await this.sources.prepareSweep(limit);
    let attached = 0;
    let pending = 0;
    for (const reconcile of candidates) {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockBillingPricing(tx);
        const tiers = await tx.billingOffer.findMany({
          where: { archived: false, availableForAssignment: true },
          select: {
            id: true,
            benefits: true,
            contentScope: true,
            archived: true,
            availableForAssignment: true,
          },
        });
        // Тариф без состава не назначается: подтверждённый источник ждёт, пока состав задан.
        return reconcile(
          tx,
          tiers
            .filter(tierOpenForAssignment)
            .map((tier) => z.uuid().parse(tier.id)),
        );
      });
      attached += result.attached;
      pending += result.pending;
    }
    return { scanned: candidates.length, attached, pending };
  }
}
