import { BillingPricing } from "../../../src/modules/billing/index.js";
import type { Accounts } from "../../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../../src/modules/membership-entitlements/index.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

/** Проверки каталога читают реальные основания Account, даже когда проверяется только цена. */
export function assembleTestBillingPricing(
  dependencies: Omit<
    ConstructorParameters<typeof BillingPricing>[0],
    "prisma" | "accounts"
  > & { prisma: PlatformPrisma; accounts: Accounts },
): BillingPricing {
  return new BillingPricing({
    ...dependencies,
    grants: dependencies.grants ?? assembleAccessGrants(dependencies),
  });
}
