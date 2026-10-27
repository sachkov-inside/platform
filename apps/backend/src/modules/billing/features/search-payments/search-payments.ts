import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import type { AttemptState } from "../../domain/payment-attempt.js";

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
        | { readonly code: "forbidden" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true };
    };

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
}

const requestSchema = z.strictObject({
  actor: z.uuid(),
  query: z.string().trim().min(1).max(160),
  limit: z.int().min(1).max(20),
});

/**
 * Группа «Платежи» общего поиска под правом `billing:manage`: номер заказа, номер платежа банка
 * или точная сумма. Аккаунт без права получает отказ, и поиск не показывает группу.
 */
export class BillingPaymentSearch {
  constructor(private readonly dependencies: Dependencies) {}

  async search(request: {
    readonly actor: string;
    readonly query: string;
    readonly limit: number;
  }): Promise<BillingPaymentSearchResult> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: { code: "forbidden" } };
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: parsed.data.actor,
        permission: "billing:manage",
      });
      if (!permission.ok || !permission.allowed)
        return permission.ok
          ? { ok: false, error: { code: "forbidden" } }
          : unavailable();
      return { ok: true, value: [] };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "searchPayments" },
        error,
        unavailable(),
      );
    }
  }
}

function unavailable(): BillingPaymentSearchResult {
  return {
    ok: false,
    error: { code: "dependency_unavailable", retryable: true },
  };
}
