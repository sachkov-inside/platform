import { Module, type DynamicModule } from "@nestjs/common";
import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { PrismaModule } from "../../infrastructure/prisma/index.js";
import { RuntimeIdentityModule } from "../../infrastructure/runtime-identity.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { BillingModule } from "../../modules/billing/index.js";
import { ContentScopeCatalogModule } from "../../modules/materials/index.js";
import { CommunityEntitlementsModule, RecipientLinksModule } from "../../modules/telegram-membership/index.js";

@Module({})
export class BillingWorkerModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    return { module: BillingWorkerModule, imports: [PlatformConfigModule.forRoot(config, "billing-worker"), RuntimeIdentityModule, PrismaModule, BillingModule, CommunityEntitlementsModule, ContentScopeCatalogModule, RecipientLinksModule], providers: [OperationalReadiness] };
  }
}
