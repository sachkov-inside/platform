import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { isProductCapability } from "@inside/access-capabilities";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { canonicalJson } from "../../../../infrastructure/contracts/canonical-digest.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockBillingPricing,
  type BillingPrisma,
  type BillingPrismaClient,
  type Prisma,
} from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
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
import {
  decodeListCursor,
  encodeListCursor,
} from "../../shared/list-cursor.js";
import {
  selectPrice,
  selectPricesForOptions,
} from "../../shared/select-price.js";
import {
  offerGrantsWithheld,
  tierLacksComposition,
} from "../../shared/tier-composition.js";
import {
  paymentLinkCommandSchema,
  paymentLinksListSchema,
  paymentLinkViewSchema,
  type paymentLinksPageSchema,
  type PaymentLinkState,
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
    return await dependencies.prisma.$transaction(
      async (tx): Promise<CommandResult> => {
        await lockBillingPricing(tx);
        const permission = await dependencies.accounts.checkPermission(
          { accountId: identity.data, permission: "billing:manage" },
          transactionHandle(tx),
        );
        if (!permission.ok) return failure("dependency_unavailable");
        if (!permission.allowed) return failure("forbidden");
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
            command.productId,
            now,
            undefined,
            { allowUnpublished: true },
          );
          if (!price.ok) return price;
          const source = price.value;
          if (source.paymentOption.revision !== command.priceRevision)
            return failure("quote_changed");
          const products = source.offer.benefits.filter(isProductCapability);
          if (
            paymentMode(source.paymentOption) !== "one_time" ||
            products.length !== 1 ||
            tierLacksComposition({
              ...source.offer,
              coverage: source.offer.coverage,
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
  const current = await selectPrice(
    tx,
    snapshot.paymentOption.id,
    now,
    undefined,
    { allowUnpublished: true },
  );
  return {
    ok: true,
    value: projectPaymentLink(
      row,
      snapshot,
      reserved?.state ?? null,
      current.ok ? current.value : null,
      now,
    ),
  };
}

type PaymentLinkRow = Awaited<
  ReturnType<BillingPrisma["billingPaymentLink"]["findMany"]>
>[number];
function projectPaymentLink(
  row: PaymentLinkRow,
  snapshot: PriceSnapshot,
  reservationState: string | null,
  current: PriceSnapshot | null,
  now: Date,
): PaymentLinkView {
  let state: PaymentLinkView["state"] =
    reservationState === "confirmed"
      ? "paid"
      : reservationState === "unknown"
        ? "unknown"
        : reservationState !== null
          ? "pending"
          : row.revokedAt !== null
            ? "revoked"
            : row.expiresAt !== null && row.expiresAt <= now
              ? "expired"
              : "active";
  if (
    state === "active" &&
    (current === null ||
      canonicalJson({
        benefits: current.offer.benefits,
        benefitPeriods: current.offer.benefitPeriods,
        coverage: current.offer.coverage,
      }) !==
        canonicalJson({
          benefits: snapshot.offer.benefits,
          benefitPeriods: snapshot.offer.benefitPeriods,
          coverage: snapshot.offer.coverage,
        }))
  )
    state = "changed";
  return {
    id: row.id,
    revision: row.revision,
    state,
    snapshot,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
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
    case "active": {
      // Ссылка сохраняет состояние продажи, в котором её выдали. Выданная при закрытой продаже
      // (цена не опубликована) продаёт, пока цена не в архиве. Выданную при открытой продаже
      // закрывает снятие цены с публикации: это закрытие продаж.
      const current = await selectPrice(
        tx,
        result.value.snapshot.product?.id ?? optionId,
        now,
        undefined,
        { allowUnpublished: true },
      );
      if (!current.ok) return failure("not_found");
      if (
        current.value.offer.published === false &&
        result.value.snapshot.offer.published !== false
      )
        return failure("not_found");
      return { ok: true, value: result.value.snapshot };
    }
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
      const { limit, cursor, productId, state } = parsed.data;
      const scope: Prisma.BillingPaymentLinkWhereInput =
        productId === undefined
          ? {}
          : { snapshot: { path: ["product", "id"], equals: productId } };
      // Состояние ссылки меняется со временем: cursor связан с фильтром, а не со строкой.
      const cursorScope = {
        productId: productId ?? null,
        state: state ?? null,
      };
      const after =
        cursor === undefined ? null : decodeListCursor(cursor, cursorScope);
      if (cursor !== undefined && after === null)
        return failure("invalid_request");
      const rows = await tx.billingPaymentLink.findMany({
        where: {
          AND: [
            scope,
            state === undefined ? {} : stateCandidates(state, now),
            after === null
              ? {}
              : {
                  OR: [
                    { createdAt: { lt: after.at } },
                    { createdAt: after.at, id: { lt: after.id } },
                  ],
                },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const snapshots = new Map(
        page.map((row) => [row.id, priceSnapshotSchema.parse(row.snapshot)]),
      );
      const reservations = await tx.billingPromoReservation.findMany({
        where: {
          paymentLinkId: { in: page.map((row) => row.id) },
          state: { not: "failed" },
        },
        select: { paymentLinkId: true, state: true },
      });
      const reservationStates = new Map(
        reservations.map((row) => [row.paymentLinkId, row.state]),
      );
      const optionIds = [
        ...new Set(
          [...snapshots.values()].map((snapshot) => snapshot.paymentOption.id),
        ),
      ];
      const options = await tx.billingProductPrice.findMany({
        where: { productId: { in: optionIds } },
      });
      const prices = await selectPricesForOptions(tx, options, now, undefined, {
        allowUnpublished: true,
      });
      const items = page.map((row) => {
        const snapshot = snapshots.get(row.id);
        if (snapshot === undefined)
          throw new Error("Payment link snapshot missing");
        const current = prices.get(snapshot.paymentOption.id);
        return projectPaymentLink(
          row,
          snapshot,
          reservationStates.get(row.id) ?? null,
          current?.ok === true ? current.value : null,
          now,
        );
      });
      // «active» и «changed» различает только сравнение с текущей ценой: страница кандидатов
      // может стать короче, а продолжение идёт по последней прочитанной строке.
      return {
        ok: true as const,
        value: {
          items:
            state === undefined
              ? items
              : items.filter((item) => item.state === state),
          nextCursor:
            rows.length > limit && last !== undefined
              ? encodeListCursor(cursorScope, {
                  at: last.createdAt,
                  id: last.id,
                })
              : null,
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

/**
 * Строки, чьё видимое состояние может совпасть с `state`, по тем же правилам, что
 * `projectPaymentLink`: незавершённый резерв важнее отзыва, отзыв важнее срока.
 */
function stateCandidates(
  state: PaymentLinkState,
  now: Date,
): Prisma.BillingPaymentLinkWhereInput {
  const unreserved = { reservations: { none: { state: { not: "failed" } } } };
  switch (state) {
    case "paid":
      return { reservations: { some: { state: "confirmed" } } };
    case "unknown":
      return { reservations: { some: { state: "unknown" } } };
    case "pending":
      return {
        reservations: {
          some: { state: { notIn: ["confirmed", "unknown", "failed"] } },
        },
      };
    case "revoked":
      return { ...unreserved, revokedAt: { not: null } };
    case "expired":
      return { ...unreserved, revokedAt: null, expiresAt: { lte: now } };
    case "active":
    case "changed":
      return {
        ...unreserved,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
  }
}
