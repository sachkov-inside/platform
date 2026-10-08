import { Global, Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  COVERAGE_CATALOG,
  type CoverageCatalog as CoverageCatalogPort,
} from "../account-rights/index.js";
import { CoverageCatalog } from "./facets/coverage-catalog/coverage-catalog.js";

/**
 * Materials' implementation of the Membership Entitlements content scope port. Global, because
 * Membership Entitlements must not import Materials; each process that loads Membership
 * Entitlements imports this module in its entrypoint.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: COVERAGE_CATALOG,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): CoverageCatalogPort =>
        new CoverageCatalog(prisma),
    },
  ],
  exports: [COVERAGE_CATALOG],
})
export class CoverageCatalogModule {}
