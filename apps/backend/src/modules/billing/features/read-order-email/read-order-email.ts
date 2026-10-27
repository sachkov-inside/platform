import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import type { Tbank } from "../../infrastructure/tbank/tbank.js";
import {
  hasSealedOrderEmail,
  openOrderEmail,
} from "../../shared/order-email.js";
import type { OwnerOrderEmail } from "./read-order-email.contract.js";

export type OwnerOrderEmailResult =
  | { readonly ok: true; readonly value: OwnerOrderEmail }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "forbidden" | "not_found" | "dependency_unavailable";
      };
    };

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly bank: Pick<Tbank, "openBinding"> | undefined;
}

/**
 * Order Email для владельца: отдельное чтение одной страницы платежа. Его нет в owner-операциях,
 * MCP, списках и поиске; адрес не попадает ни в журнал, ни в ошибку.
 */
export class OwnerOrderEmailRead {
  constructor(private readonly dependencies: Dependencies) {}

  async read(
    actorId: string,
    purchaseRef: string,
  ): Promise<OwnerOrderEmailResult> {
    if (!z.uuid().safeParse(actorId).success) return refusal("forbidden");
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: actorId,
        permission: "billing:manage",
      });
      if (!permission.ok) return refusal("dependency_unavailable");
      if (!permission.allowed) return refusal("forbidden");
      if (!z.uuid().safeParse(purchaseRef).success) return refusal("not_found");
      const row = await this.dependencies.prisma.billingPurchase.findUnique({
        where: { id: purchaseRef },
        select: { id: true, contact: true },
      });
      if (row === null) return refusal("not_found");
      if (!hasSealedOrderEmail(row.contact))
        return { ok: true, value: { email: null } };
      const bank = this.dependencies.bank;
      if (bank === undefined) return refusal("dependency_unavailable");
      return {
        ok: true,
        value: { email: openOrderEmail(bank, row.id, row.contact) },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "readOwnerOrderEmail" },
        error,
        refusal("dependency_unavailable"),
      );
    }
  }
}

function refusal<
  const Code extends "forbidden" | "not_found" | "dependency_unavailable",
>(code: Code): { readonly ok: false; readonly error: { readonly code: Code } } {
  return { ok: false, error: { code } };
}
