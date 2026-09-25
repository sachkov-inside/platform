import { Global, Module } from "@nestjs/common";

import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { CONTENT_SCOPE_CATALOG, type ContentScopeCatalog as ContentScopeCatalogPort } from "../membership-entitlements/index.js";
import { ContentScopeCatalog } from "./facets/content-scope-catalog/content-scope-catalog.js";

/**
 * Materials' implementation of the Membership Entitlements content scope port. Global, because
 * Membership Entitlements must not import Materials; each process that loads Membership
 * Entitlements imports this module in its entrypoint.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{
    provide: CONTENT_SCOPE_CATALOG,
    inject: [PrismaClientProvider],
    useFactory: (prisma: PrismaClientProvider): ContentScopeCatalogPort => new ContentScopeCatalog(prisma),
  }],
  exports: [CONTENT_SCOPE_CATALOG],
})
export class ContentScopeCatalogModule {}
