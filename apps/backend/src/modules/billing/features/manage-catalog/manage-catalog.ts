import type { Accounts } from "../../../accounts/index.js";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { failure, idSchema, type PricingResult } from "../../domain/pricing.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { catalogOutcomeSchema, manageCatalogSchema, type ManageCatalogCommand } from "./manage-catalog.contract.js";

type Outcome = { id: string; revision: number; archived: boolean; published?: boolean | undefined };
type ManageCatalogResult = PricingResult<Outcome,
  "invalid_request" | "forbidden" | "not_found" | "revision_conflict" | "operation_conflict" | "reservation_conflict" | "dependency_unavailable"
>;

export async function manageCatalog(dependencies: { prisma: BillingPrismaClient; accounts: Pick<Accounts, "checkPermission"> }, actor: string, input: unknown): Promise<ManageCatalogResult> {
  const parsed = manageCatalogSchema.safeParse(input);
  const identity = idSchema.safeParse(actor);
  if (!parsed.success || !identity.success) return failure("invalid_request");
  try {
    // Каталог — часть billing:manage; platform:admin владельца включает это право.
    const permission = await dependencies.accounts.checkPermission({ accountId: identity.data, permission: "billing:manage" });
    if (!permission.ok) return failure("dependency_unavailable");
    if (!permission.allowed) return failure("forbidden");
    return await dependencies.prisma.$transaction(async (tx): Promise<ManageCatalogResult> => {
      await lockPricing(tx);
      const command = parsed.data.operation === "promotions.save" ? {
        ...parsed.data, value: { ...parsed.data.value, startsAt: new Date(parsed.data.value.startsAt).toISOString(), endsAt: new Date(parsed.data.value.endsAt).toISOString() },
      } : parsed.data;
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

async function changeCatalog(tx: BillingPrisma, command: ManageCatalogCommand): Promise<ManageCatalogResult> {
  const id = "value" in command ? command.value.id : command.id;
  const current = command.operation.startsWith("offers.") ? await tx.billingOffer.findUnique({ where: { id } })
    : command.operation.startsWith("paymentOptions.") ? await tx.billingPaymentOption.findUnique({ where: { id } })
    : await tx.billingPromotion.findUnique({ where: { id } });
  if ((current?.revision) !== command.expectedRevision) return failure("revision_conflict");
  if (!current && !('value' in command)) return failure("not_found");
  const currentPublished = current !== null && "published" in current ? current.published : false;
  const revision = (current?.revision ?? 0) + 1;
  const archived = !('value' in command);
  switch (command.operation) {
    case "offers.save": {
      const periods = command.value.benefitPeriods ?? [];
      if (new Set(periods.map(value => value.capability)).size !== periods.length || periods.some(value => !command.value.benefits.includes(value.capability))) return failure("invalid_request");
      const data = { ...command.value, benefitPeriods: periods, revision, archived: false };
      await tx.billingOffer.upsert({ where: { id }, create: data, update: data });
      return { ok: true, value: { id, revision, archived: false, published: currentPublished } };
    }
    case "offers.archive": {
      // Архив — окончательное снятие; обратимый признак продажи при этом сохраняется как был.
      await tx.billingOffer.update({ where: { id }, data: { revision, archived } });
      return { ok: true, value: { id, revision, archived, published: currentPublished } };
    }
    case "offers.publish": case "offers.unpublish": {
      if (current === null || current.archived) return failure("not_found");
      const published = command.operation === "offers.publish";
      await tx.billingOffer.update({ where: { id }, data: { revision, published } });
      return { ok: true, value: { id, revision, archived: false, published } };
    }
    case "paymentOptions.save": {
      const offer = await tx.billingOffer.findUnique({ where: { id: command.value.offerId } });
      if (!offer || offer.archived) return failure("not_found");
      const data = { ...command.value, mode: command.value.mode ?? "subscription", revision, archived: false };
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
