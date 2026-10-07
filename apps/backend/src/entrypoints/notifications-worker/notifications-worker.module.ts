import { NotificationsModule } from "../../modules/notifications/index.js";
import { CoverageCatalogModule } from "../../modules/materials/index.js";
import { RecipientLinksModule } from "../../modules/telegram-membership/index.js";
import { ProductTaskResourceFactsModule } from "../../modules/product-tasks/index.js";
import { Module } from "@nestjs/common";
import { PlatformConfigModule } from "../../config/platform-config.module.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { PrismaModule } from "../../infrastructure/prisma/index.js";
import { RuntimeIdentityModule } from "../../infrastructure/runtime-identity.js";

@Module({
  imports: [
    PlatformConfigModule.forRoot(undefined, "notifications-worker"),
    PrismaModule,
    RuntimeIdentityModule,
    NotificationsModule,
    CoverageCatalogModule,
    RecipientLinksModule,
    ProductTaskResourceFactsModule,
  ],
  providers: [OperationalReadiness],
})
export class NotificationsWorkerModule {}
