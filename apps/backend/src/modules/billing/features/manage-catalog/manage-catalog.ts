import type { Accounts } from "../../../accounts/index.js";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { failure, idSchema, type PricingResult } from "../../domain/pricing.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { catalogOutcomeSchema, manageCatalogSchema, type ManageCatalogCommand } from "./manage-catalog.contract.js";

type Outcome = { id: string; revision: number; archived: boolean };
export async function manageCatalog(dependencies: { prisma: BillingPrismaClient; accounts: Pick<Accounts, "checkPermission"> }, actor: string, input: unknown): Promise<PricingResult<Outcome>> {
  const parsed = manageCatalogSchema.safeParse(input);
  const identity = idSchema.safeParse(actor);
  if (!parsed.success || !identity.success) return failure("invalid_request");
  try {
    return await dependencies.prisma.$transaction(async (tx): Promise<PricingResult<Outcome>> => {
      await lockPricing(tx);
      const permission = await dependencies.accounts.checkPermission({ accountId: identity.data, permission: "platform:admin" });
      if (!permission.ok) return failure("dependency_unavailable");
      if (!permission.allowed) return failure("forbidden");
      const command = parsed.data;
      const key = { actor: identity.data, operationId: command.operationId };
      const fingerprint = JSON.stringify(command);
      const receipt = await tx.billingPricingCommand.findUnique({ where: { actor_operationId: key } });
      if (receipt) return receipt.fingerprint === fingerprint
        ? { ok: true, value: catalogOutcomeSchema.parse(receipt.outcome) } : failure("operation_conflict");
      const result = await changeCatalog(tx, command);
      if (result.ok) await tx.billingPricingCommand.create({ data: { ...key, fingerprint, outcome: result.value } });
      return result;
    });
  } catch { return failure("dependency_unavailable"); }
}

async function changeCatalog(tx: BillingPrisma, command: ManageCatalogCommand): Promise<PricingResult<Outcome>> {
  const id = "value" in command ? command.value.id : command.id;
  const current = command.operation.startsWith("offers.") ? await tx.billingOffer.findUnique({ where: { id } })
    : command.operation.startsWith("paymentOptions.") ? await tx.billingPaymentOption.findUnique({ where: { id } })
    : await tx.billingPromotion.findUnique({ where: { id } });
  if ((current?.revision) !== command.expectedRevision) return failure("revision_conflict");
  if (!current && !('value' in command)) return failure("not_found");
  const revision = (current?.revision ?? 0) + 1;
  const archived = !('value' in command);
  switch (command.operation) {
    case "offers.save": {
      const data = { ...command.value, revision, archived: false };
      await tx.billingOffer.upsert({ where: { id }, create: data, update: data });
      break;
    }
    case "offers.archive": await tx.billingOffer.update({ where: { id }, data: { revision, archived } }); break;
    case "paymentOptions.save": {
      const offer = await tx.billingOffer.findUnique({ where: { id: command.value.offerId } });
      if (!offer || offer.archived) return failure("not_found");
      const data = { ...command.value, revision, archived: false };
      await tx.billingPaymentOption.upsert({ where: { id }, create: data, update: data });
      break;
    }
    case "paymentOptions.archive": await tx.billingPaymentOption.update({ where: { id }, data: { revision, archived } }); break;
    case "promotions.save": {
      const value = command.value;
      if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) return failure("invalid_request");
      if (value.code !== null && await tx.billingPromotion.findFirst({ where: { code: value.code, id: { not: id } } })) return failure("operation_conflict");
      if (await tx.billingOffer.count({ where: { id: { in: value.offerIds } } }) !== new Set(value.offerIds).size ||
        await tx.billingPaymentOption.count({ where: { id: { in: value.paymentOptionIds } } }) !== new Set(value.paymentOptionIds).size) return failure("not_found");
      const committed = await tx.billingPromoReservation.count({ where: { promotionId: id, state: { not: "failed" } } });
      if (value.usageLimit !== null && value.usageLimit < committed) return failure("reservation_conflict");
      const data = { ...value, startsAt: new Date(value.startsAt), endsAt: new Date(value.endsAt), revision, archived: false };
      await tx.billingPromotion.upsert({ where: { id }, create: data, update: data });
      break;
    }
    case "promotions.archive": await tx.billingPromotion.update({ where: { id }, data: { revision, archived } }); break;
  }
  return { ok: true, value: { id, revision, archived } };
}
