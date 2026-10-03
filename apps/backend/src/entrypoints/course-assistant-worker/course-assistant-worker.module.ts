import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { PrismaModule } from "../../infrastructure/prisma/index.js";
import { RuntimeIdentityModule } from "../../infrastructure/runtime-identity.js";
import { AccountsModule } from "../../modules/accounts/index.js";
import { BillingModule } from "../../modules/billing/index.js";
import { CommunicationsModule } from "../../modules/communications/index.js";
import { ContentScopeCatalogModule } from "../../modules/materials/index.js";
import { RecipientLinksModule } from "../../modules/telegram-membership/index.js";
import { PracticeReviewerModule } from "../../modules/course-assistant/index.js";

@Module({})
export class CourseAssistantWorkerModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    return {
      module: CourseAssistantWorkerModule,
      imports: [
        PlatformConfigModule.forRoot(config, "course-assistant-worker"),
        RuntimeIdentityModule,
        PrismaModule,
        // Чтение материалов собирается так же, как в MCP: Materials зависит от этих модулей.
        AccountsModule,
        CommunicationsModule,
        BillingModule,
        ContentScopeCatalogModule,
        RecipientLinksModule,
        PracticeReviewerModule,
      ],
      providers: [OperationalReadiness],
    };
  }
}
