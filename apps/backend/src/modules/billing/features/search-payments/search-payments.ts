import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  BillingPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import {
  attemptStateSchema,
  type AttemptState,
} from "../../domain/payment-attempt.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";

/** Платёж в общем поиске: без человека, адреса и банковских подробностей. */
export interface BillingPaymentHit {
  readonly purchaseRef: string;
  readonly productName: string;
  readonly amountKopecks: number;
  readonly state: AttemptState;
  readonly createdAt: string;
}

export type BillingPaymentSearchResult =
  | { readonly ok: true; readonly value: readonly BillingPaymentHit[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "forbidden" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true };
    };

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
}

/** Больше всего покупателей, чьи платежи ищет один запрос. */
export const PAYMENT_SEARCH_ACCOUNT_LIMIT = 20;

const requestSchema = z.strictObject({
  actor: z.uuid(),
  query: z.string().trim().min(1).max(160),
  limit: z.int().min(1).max(20),
  accountIds: z
    .array(z.uuid().toLowerCase())
    .max(PAYMENT_SEARCH_ACCOUNT_LIMIT)
    .default([]),
});

/**
 * Группа «Платежи» общего поиска под правом `billing:manage`: номер заказа, номер платежа банка,
 * точная сумма или покупатель из `accountIds`, которых нашёл поиск людей. Аккаунт без права
 * получает отказ, и поиск не показывает группу. Ответ не называет покупателя.
 */
export class BillingPaymentSearch {
  constructor(private readonly dependencies: Dependencies) {}

  async search(request: {
    readonly actor: string;
    readonly query: string;
    readonly limit: number;
    readonly accountIds?: readonly string[];
  }): Promise<BillingPaymentSearchResult> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: parsed.data.actor,
        permission: "billing:manage",
      });
      // An Account that does not exist holds no right; only a failed decision is unavailable.
      if (!permission.ok)
        return permission.error.code === "account_not_found" ||
          permission.error.code === "invalid_input"
          ? { ok: false, error: { code: "forbidden" } }
          : unavailable();
      if (!permission.allowed)
        return { ok: false, error: { code: "forbidden" } };
      const where = matchOf(parsed.data.query, parsed.data.accountIds);
      if (where === null) return { ok: true, value: [] };
      const rows = await this.dependencies.prisma.billingPurchase.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: parsed.data.limit,
        select: {
          id: true,
          snapshot: true,
          amountKopecks: true,
          state: true,
          createdAt: true,
        },
      });
      return {
        ok: true,
        value: rows.map((row) => {
          const snapshot = priceSnapshotSchema.parse(row.snapshot);
          return {
            purchaseRef: row.id,
            productName: snapshot.product?.name ?? snapshot.offer.name,
            amountKopecks: Number(row.amountKopecks),
            state: attemptStateSchema.parse(row.state),
            createdAt: row.createdAt.toISOString(),
          };
        }),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "searchPayments" },
        error,
        unavailable(),
      );
    }
  }
}

/** «1 990 ₽», «1990 руб.», «1 990,50»: целые рубли с необязательными копейками и знаком рубля. */
const amountPattern = /^(\d{1,13})(?:[.,](\d{1,2}))?(?:₽|руб\.?|р\.?)?$/iu;
const bankPaymentIdPattern = /^\d{1,20}$/u;

/**
 * Номер заказа совпадает целиком; цифры совпадают с номером платежа банка или с суммой в
 * рублях; сумма со знаком рубля или копейками совпадает только с суммой. Платежи найденных
 * людей добавляются к любому из этих совпадений. Другой текст сам по себе не ищет.
 */
function matchOf(
  query: string,
  accountIds: readonly string[],
): Prisma.BillingPurchaseWhereInput | null {
  const conditions: Prisma.BillingPurchaseWhereInput[] =
    accountIds.length === 0 ? [] : [{ accountId: { in: [...accountIds] } }];
  const reference = z.uuid().safeParse(query);
  if (reference.success) conditions.push({ id: reference.data.toLowerCase() });
  else if (bankPaymentIdPattern.test(query))
    conditions.push({ paymentId: query });
  const amount = amountPattern.exec(query.replace(/\s/gu, ""));
  if (amount !== null) {
    const [, rubles = "", fraction = ""] = amount;
    conditions.push({
      amountKopecks: BigInt(rubles) * 100n + BigInt(fraction.padEnd(2, "0")),
    });
  }
  return conditions.length === 0 ? null : { OR: conditions };
}

function unavailable(): BillingPaymentSearchResult {
  return {
    ok: false,
    error: { code: "dependency_unavailable", retryable: true },
  };
}
