import { ActivityRetentionDiagnostics } from "./mcp/activity-retention-diagnostics.js";
import { ReadingActivityRetention } from "../modules/reading-activity/index.js";
import { BookmarkActivityRetention } from "../modules/bookmarks/index.js";
import { ParticipantDiagnostics } from "./mcp/participant-diagnostics.js";
import {
  ReadingActivityFacts,
  ReadingActivityModule,
} from "../modules/reading-activity/index.js";
import {
  BookmarkActivityFacts,
  BookmarksModule,
} from "../modules/bookmarks/index.js";
import { TaskSubmissionFacts } from "../modules/product-tasks/index.js";
import { ACCOUNTS, type Accounts } from "../modules/accounts/index.js";
import { PgBossQueueDiagnostics } from "../infrastructure/pg-boss-queue-diagnostics.js";
import { QueueDiagnostics } from "./mcp/queue-diagnostics.js";
import { SalesFunnelModule } from "../modules/sales-funnel/index.js";
import { WebTelemetryModule } from "../modules/web-telemetry/index.js";
import { BillingModule } from "../modules/billing/index.js";
import { CommunicationsModule } from "../modules/communications/index.js";
import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../config/platform-config.module.js";
import type { PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { RuntimeIdentityModule } from "../infrastructure/runtime-identity.js";
import { PrismaModule } from "../infrastructure/prisma/index.js";
import { AccountsModule } from "../modules/accounts/index.js";
import {
  CoverageCatalogModule,
  MaterialsModule,
} from "../modules/materials/index.js";
import { RecipientLinksModule } from "../modules/telegram-membership/index.js";
import {
  ProductTaskResourceFactsModule,
  ProductTasksModule,
} from "../modules/product-tasks/index.js";

@Module({
  providers: [
    {
      provide: ActivityRetentionDiagnostics,
      inject: [
        ACCOUNTS,
        ReadingActivityRetention,
        BookmarkActivityRetention,
        PgBossQueueDiagnostics,
      ],
      useFactory: (
        accounts: Accounts,
        reading: ReadingActivityRetention,
        bookmarks: BookmarkActivityRetention,
        receipts: PgBossQueueDiagnostics,
      ) =>
        new ActivityRetentionDiagnostics(
          accounts,
          reading,
          bookmarks,
          receipts,
        ),
    },
    OperationalReadiness,
    PgBossQueueDiagnostics,
    QueueDiagnostics,
    {
      provide: ParticipantDiagnostics,
      inject: [
        ACCOUNTS,
        ReadingActivityFacts,
        BookmarkActivityFacts,
        TaskSubmissionFacts,
      ],
      useFactory: (
        accounts: Accounts,
        reading: ReadingActivityFacts,
        bookmarks: BookmarkActivityFacts,
        submissions: TaskSubmissionFacts,
      ) =>
        new ParticipantDiagnostics(accounts, reading, bookmarks, submissions),
    },
  ],
})
export class McpModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    return {
      module: McpModule,
      imports: [
        PlatformConfigModule.forRoot(config, "mcp"),
        RuntimeIdentityModule,
        PrismaModule,
        AccountsModule,
        WebTelemetryModule,
        CommunicationsModule,
        MaterialsModule,
        BillingModule,
        SalesFunnelModule,
        ProductTasksModule,
        ReadingActivityModule,
        BookmarksModule,
        CoverageCatalogModule,
        RecipientLinksModule,
        ProductTaskResourceFactsModule,
      ],
    };
  }
}
