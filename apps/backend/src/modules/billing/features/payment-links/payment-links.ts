import type { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Accounts } from "../../../accounts/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockBillingPricing,
  type BillingPrisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { canonicalJson } from "../../../../infrastructure/contracts/canonical-digest.js";
import {
  discountedPrice,
  failure,
  idSchema,
  paymentMode,
  priceSnapshotSchema,
  type PriceSnapshot,
  type PricingResult,
} from "../../domain/pricing.js";
import type { SaleCapability } from "../../domain/sale-capability.js";
import { replayCommandFingerprint } from "../../shared/command-fingerprint.js";
import { selectPrice } from "../../shared/select-price.js";
import {
  offerGrantsWithheld,
  productSupportTermMissing,
  tierLacksComposition,
} from "../../shared/tier-composition.js";
import { isProductCapability } from "@inside/access-capabilities";
import {
  paymentLinksListSchema,
  type paymentLinksPageSchema,
  paymentLinkCommandSchema,
  paymentLinkViewSchema,
  type PaymentLinkView,
} from "./payment-links.contract.js";

type CommandResult = PricingResult<
  PaymentLinkView,
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "revision_conflict"
  | "operation_conflict"
  | "reservation_conflict"
  | "dependency_unavailable"
  | "method_unavailable"
  | "unsupported_amount"
  | "quote_changed"
>;
type Dependencies = {
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly sale: SaleCapability;
};

/** Owner commands and purchase reservation share the pricing lock. Link id is a random UUID bearer capability. */
export async function managePaymentLink(
  dependencies: Dependencies,
  actor: string,
  input: unknown,
  now: Date,
): Promise<CommandResult> {
  const identity = idSchema.safeParse(actor),
    parsed = paymentLinkCommandSchema.safeParse(input);
  if (!identity.success || !parsed.success) return failure("invalid_request");
  try {
    const permission = await dependencies.accounts.checkPermission({
      accountId: identity.data,
      permission: "billing:manage",
    });
    if (!permission.ok) return failure("dependency_unavailable");
    if (!permission.allowed) return failure("forbidden");
    return await dependencies.prisma.$transaction(
      async (tx): Promise<CommandResult> => {
        await lockBillingPricing(tx);
        const command = parsed.data,
          key = { actor: identity.data, operationId: command.operationId };
        const fingerprint = replayCommandFingerprint("paymentLinks", command);
        const prior = await tx.billingPricingCommand.findUnique({
          where: { actor_operationId: key },
        });
        if (prior)
          return fingerprint.recognizes(prior.fingerprint)
            ? { ok: true, value: paymentLinkViewSchema.parse(prior.outcome) }
            : failure("operation_conflict");
        let id: string;
        if (command.operation === "paymentLinks.create") {
          if (!dependencies.sale.payments) return failure("method_unavailable");
          const price = await selectPrice(
            tx,
            command.paymentOptionId,
            now,
            undefined,
            { allowUnpublished: true },
          );
          if (!price.ok) return price;
          const source = price.value;
          if (source.paymentOption.revision !== command.optionRevision)
            return failure("quote_changed");
          const products = source.offer.benefits.filter(isProductCapability);
          if (
            paymentMode(source.paymentOption) !== "one_time" ||
            products.length !== 1 ||
            tierLacksComposition({
              ...source.offer,
              coverage: source.offer.coverage,
            }) ||
            productSupportTermMissing({
              ...source.offer,
              benefitPeriods: source.offer.benefitPeriods,
            }) ||
            offerGrantsWithheld(source.offer)
          )
            return failure("invalid_request");
          const expiresAt =
            command.expiresAt === null ? null : new Date(command.expiresAt);
          if (expiresAt !== null && expiresAt <= now)
            return failure("invalid_request");
          const amount =
            command.price.kind === "amount"
              ? command.price.amountKopecks
              : discountedPrice(
                  source.paymentOption.priceKopecks,
                  command.price.percent,
                );
          const limits = dependencies.sale.amountLimits;
          if (
            amount < 100 ||
            amount > 100_000_000 ||
            (limits !== undefined &&
              (amount < limits.minimumKopecks ||
                amount > limits.maximumKopecks))
          )
            return failure("unsupported_amount");
          id = randomUUID();
          const snapshot: PriceSnapshot = {
            ...source,
            promotion: null,
            firstPriceKopecks: amount,
            individualPayment: {
              linkId: id,
              basePriceKopecks: source.paymentOption.priceKopecks,
            },
          };
          await tx.billingPaymentLink.create({
            data: { id, revision: 1, snapshot, createdAt: now, expiresAt },
          });
        } else {
          id = command.id;
          const link = await tx.billingPaymentLink.findUnique({
            where: { id },
          });
          if (link === null) return failure("not_found");
          if (link.revision !== command.expectedRevision)
            return failure("revision_conflict");
          const reserved = await tx.billingPromoReservation.findFirst({
            where: { paymentLinkId: id, state: { not: "failed" } },
          });
          if (reserved !== null) return failure("reservation_conflict");
          if (link.revokedAt === null)
            await tx.billingPaymentLink.update({
              where: { id },
              data: { revokedAt: now, revision: { increment: 1 } },
            });
        }
        const view = await readPaymentLinkInTransaction(tx, id, now);
        if (!view.ok) return view;
        await tx.billingPricingCommand.create({
          data: {
            ...key,
            fingerprint: fingerprint.digest,
            outcome: view.value,
          },
        });
        return view;
      },
    );
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "managePaymentLink" },
      error,
      failure("dependency_unavailable"),
    );
  }
}

export async function readPaymentLink(
  prisma: BillingPrismaClient,
  id: string,
  now: Date,
): Promise<
  PricingResult<PaymentLinkView, "not_found" | "dependency_unavailable">
> {
  if (!idSchema.safeParse(id).success) return failure("not_found");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      return readPaymentLinkInTransaction(tx, id, now);
    });
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "readPaymentLink" },
      error,
      failure("dependency_unavailable"),
    );
  }
}

export async function readPaymentLinkInTransaction(
  tx: BillingPrisma,
  id: string,
  now: Date,
): Promise<PricingResult<PaymentLinkView, "not_found">> {
  const row = await tx.billingPaymentLink.findUnique({ where: { id } });
  if (row === null) return failure("not_found");
  const snapshot = priceSnapshotSchema.parse(row.snapshot);
  const reserved = await tx.billingPromoReservation.findFirst({
    where: { paymentLinkId: id, state: { not: "failed" } },
  });
  let state: PaymentLinkView["state"] =
    reserved?.state === "confirmed"
      ? "paid"
      : reserved?.state === "unknown"
        ? "unknown"
        : reserved !== null
          ? "pending"
          : row.revokedAt !== null
            ? "revoked"
            : row.expiresAt !== null && row.expiresAt <= now
              ? "expired"
              : "active";
  if (state === "active") {
    const current = await selectPrice(
      tx,
      snapshot.paymentOption.id,
      now,
      undefined,
      { allowUnpublished: true },
    );
    if (
      !current.ok ||
      canonicalJson({
        benefits: current.value.offer.benefits,
        benefitPeriods: current.value.offer.benefitPeriods,
        coverage: current.value.offer.coverage,
      }) !==
        canonicalJson({
          benefits: snapshot.offer.benefits,
          benefitPeriods: snapshot.offer.benefitPeriods,
          coverage: snapshot.offer.coverage,
        })
    )
      state = "changed";
  }
  return {
    ok: true,
    value: {
      id,
      revision: row.revision,
      state,
      snapshot,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    },
  };
}

/** Link authority is rechecked at quote and inside the purchase transaction, never from URL prices. */
export async function selectPaymentLinkPrice(
  tx: BillingPrisma,
  id: string,
  optionId: string,
  now: Date,
): Promise<
  PricingResult<
    PriceSnapshot,
    "not_found" | "quote_changed" | "reservation_conflict"
  >
> {
  const result = await readPaymentLinkInTransaction(tx, id, now);
  if (!result.ok) return result;
  if (result.value.snapshot.paymentOption.id !== optionId)
    return failure("not_found");
  switch (result.value.state) {
    case "active":
      return { ok: true, value: result.value.snapshot };
    case "pending":
    case "unknown":
    case "paid":
      return failure("reservation_conflict");
    case "changed":
      return failure("quote_changed");
    case "revoked":
    case "expired":
      return failure("not_found");
  }
}

export async function listPaymentLinks(
  dependencies: Dependencies,
  actor: string,
  input: unknown,
  now: Date,
): Promise<
  PricingResult<
    z.infer<typeof paymentLinksPageSchema>,
    "invalid_request" | "forbidden" | "dependency_unavailable"
  >
> {
  const parsed = paymentLinksListSchema.safeParse(input),
    identity = idSchema.safeParse(actor);
  if (!parsed.success || !identity.success) return failure("invalid_request");
  try {
    const permission = await dependencies.accounts.checkPermission({
      accountId: identity.data,
      permission: "billing:manage",
    });
    if (!permission.ok) return failure("dependency_unavailable");
    if (!permission.allowed) return failure("forbidden");
    return await dependencies.prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      const { limit, cursor } = parsed.data;
      const rows = await tx.billingPaymentLink.findMany({
        where: cursor === undefined ? {} : { id: { gt: cursor } },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
      const page = rows.slice(0, limit),
        items: PaymentLinkView[] = [];
      for (const row of page) {
        const result = await readPaymentLinkInTransaction(tx, row.id, now);
        if (result.ok) items.push(result.value);
      }
      return {
        ok: true as const,
        value: {
          items,
          nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
        },
      };
    });
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "listPaymentLinks" },
      error,
      failure("dependency_unavailable"),
    );
  }
}
