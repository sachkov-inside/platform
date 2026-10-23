import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockBillingPricing,
  type BillingPrisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import { failure, idSchema, type PricingResult } from "../../domain/pricing.js";
import type { SaleCapability } from "../../domain/sale-capability.js";
import { replayCommandFingerprint } from "../../shared/command-fingerprint.js";
import {
  catalogOutcomeSchema,
  manageCatalogSchema,
  type ManageCatalogCommand,
} from "./manage-catalog.contract.js";

type Outcome = {
  id: string;
  revision: number;
  archived: boolean;
  published?: boolean | undefined;
};
type ManageCatalogResult = PricingResult<
  Outcome,
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "revision_conflict"
  | "operation_conflict"
  | "reservation_conflict"
  | "dependency_unavailable"
  | "method_unavailable"
>;
export async function manageCatalog(
  dependencies: {
    prisma: BillingPrismaClient;
    accounts: Pick<Accounts, "checkPermission">;
    sale: SaleCapability;
  },
  actor: string,
  input: unknown,
): Promise<ManageCatalogResult> {
  const parsed = manageCatalogSchema.safeParse(input);
  const identity = idSchema.safeParse(actor);
  if (!parsed.success || !identity.success) return failure("invalid_request");
  try {
    // Каталог — часть billing:manage; platform:admin владельца включает это право.
    const permission = await dependencies.accounts.checkPermission({
      accountId: identity.data,
      permission: "billing:manage",
    });
    if (!permission.ok) return failure("dependency_unavailable");
    if (!permission.allowed) return failure("forbidden");
    return await dependencies.prisma.$transaction(
      async (tx): Promise<ManageCatalogResult> => {
        await lockBillingPricing(tx);
        const command =
          parsed.data.operation === "promotions.save"
            ? {
                ...parsed.data,
                value: {
                  ...parsed.data.value,
                  startsAt: new Date(parsed.data.value.startsAt).toISOString(),
                  endsAt: new Date(parsed.data.value.endsAt).toISOString(),
                },
              }
            : parsed.data;
        const key = { actor: identity.data, operationId: command.operationId };
        const fingerprint = replayCommandFingerprint("manageCatalog", command);
        const receipt = await tx.billingPricingCommand.findUnique({
          where: { actor_operationId: key },
        });
        if (receipt)
          return fingerprint.recognizes(receipt.fingerprint)
            ? { ok: true, value: catalogOutcomeSchema.parse(receipt.outcome) }
            : failure("operation_conflict");
        const result = await changeCatalog(tx, command, dependencies.sale);
        if (result.ok)
          await tx.billingPricingCommand.create({
            data: {
              ...key,
              fingerprint: fingerprint.digest,
              outcome: result.value,
            },
          });
        return result;
      },
    );
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "manageCatalog" },
      error,
      failure("dependency_unavailable"),
    );
  }
}

async function changeCatalog(
  tx: BillingPrisma,
  command: ManageCatalogCommand,
  sale: SaleCapability,
): Promise<ManageCatalogResult> {
  if (command.operation === "cohorts.save") return saveCohort(tx, command);
  const id =
    "value" in command
      ? "productId" in command.value
        ? command.value.productId
        : command.value.id
      : command.id;
  const priceCommand = command.operation.startsWith("productPrices.");
  const current = priceCommand
    ? await tx.billingProductPrice.findUnique({ where: { productId: id } })
    : await tx.billingPromotion.findUnique({ where: { id } });
  if (!current && !("value" in command)) return failure("not_found");
  if (current?.revision !== command.expectedRevision)
    return failure("revision_conflict");
  const revision = (current?.revision ?? 0) + 1;
  const archived = !("value" in command);
  switch (command.operation) {
    case "productPrices.save": {
      if (current?.archived === true) return failure("not_found");
      if (command.value.published && !sale.payments)
        return failure("method_unavailable");
      const data = { ...command.value, revision, updatedAt: new Date() };
      await tx.billingProductPrice.upsert({
        where: { productId: id },
        create: data,
        update: data,
      });
      return {
        ok: true,
        value: { id, revision, archived: false, published: data.published },
      };
    }
    case "productPrices.archive": {
      await tx.billingProductPrice.update({
        where: { productId: id },
        data: {
          revision,
          archived: true,
          published: false,
          updatedAt: new Date(),
        },
      });
      return {
        ok: true,
        value: { id, revision, archived: true, published: false },
      };
    }
    case "promotions.save": {
      const value = command.value;
      if (Date.parse(value.startsAt) >= Date.parse(value.endsAt))
        return failure("invalid_request");
      if (
        value.code !== null &&
        (await tx.billingPromotion.findFirst({
          where: { code: value.code, id: { not: id } },
        }))
      )
        return failure("operation_conflict");
      if (
        (await tx.billingProductPrice.count({
          where: { productId: { in: value.offerIds } },
        })) !== new Set(value.offerIds).size ||
        (await tx.billingProductPrice.count({
          where: { productId: { in: value.paymentOptionIds } },
        })) !== new Set(value.paymentOptionIds).size
      )
        return failure("not_found");
      const committed = await tx.billingPromoReservation.count({
        where: { promotionId: id, state: { not: "failed" } },
      });
      if (value.usageLimit !== null && value.usageLimit < committed)
        return failure("reservation_conflict");
      const data = {
        ...value,
        startsAt: new Date(value.startsAt),
        endsAt: new Date(value.endsAt),
        revision,
        archived: false,
      };
      await tx.billingPromotion.upsert({
        where: { id },
        create: data,
        update: data,
      });
      break;
    }
    case "promotions.archive":
      await tx.billingPromotion.update({
        where: { id },
        data: { revision, archived },
      });
      break;
  }
  return { ok: true, value: { id, revision, archived } };
}

/**
 * Поток продукта меняется на месте: страница и бот читают текущую запись, а купленные права от неё
 * не зависят. Цена после старта у потока только показывается зачёркнутой рядом с ценой
 * предзаказа; списание берёт цену варианта оплаты. При неизменном составе прав владелец меняет
 * цену через paymentOptions.save (ADR 0033), а снимки прежних покупок сохраняются.
 */
async function saveCohort(
  tx: BillingPrisma,
  command: Extract<ManageCatalogCommand, { operation: "cohorts.save" }>,
): Promise<ManageCatalogResult> {
  const { productId, startsOn, ...value } = command.value;
  const current = await tx.billingProductCohort.findUnique({
    where: { productId },
    select: { revision: true },
  });
  if (current?.revision !== command.expectedRevision)
    return failure("revision_conflict");
  const revision = (current?.revision ?? 0) + 1;
  const data = {
    ...value,
    startsOn: startsOn === null ? null : new Date(`${startsOn}T00:00:00Z`),
    revision,
    updatedAt: new Date(),
  };
  await tx.billingProductCohort.upsert({
    where: { productId },
    create: { productId, ...data },
    update: data,
  });
  return { ok: true, value: { id: productId, revision, archived: false } };
}
