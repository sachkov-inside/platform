import { CoverageCatalog } from "../../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../../src/modules/products/index.js";
import { BillingPricing } from "../../../src/modules/billing/index.js";
import type { Accounts } from "../../../src/modules/accounts/index.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

/** Pricing reads its real owning Product catalogue through the same port as production. */
export function assembleTestBillingPricing(
  dependencies: Omit<
    ConstructorParameters<typeof BillingPricing>[0],
    "prisma" | "accounts"
  > & { prisma: PlatformPrisma; accounts: Accounts },
): BillingPricing {
  return new BillingPricing({
    contentCatalog: new CoverageCatalog(
      dependencies.prisma,
      new ProductDiscovery(dependencies.prisma),
    ),
    ...dependencies,
  });
}
