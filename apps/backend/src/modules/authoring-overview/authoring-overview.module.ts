import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/index.js";
import { ReadAuthoringOverviewController } from "./features/read-authoring-overview/read-authoring-overview.controller.js";
import { ReadProductOverviewController } from "./features/read-product-overview/read-product-overview.controller.js";
import { AuthoringOverviewReads } from "./shared/overview-reads.js";

/**
 * The admin Overview (#1719): reads composed over the owners of sales, access, people, waitlists,
 * submissions, Telegram and learning. It owns no table and no right of its own, and no Module
 * imports it (ADR 0029); the API process imports the Module.
 */
@Module({
  imports: [AccountsModule],
  controllers: [ReadAuthoringOverviewController, ReadProductOverviewController],
  providers: [AuthoringOverviewReads],
})
export class AuthoringOverviewModule {}
