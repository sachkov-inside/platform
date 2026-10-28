import { Module } from "@nestjs/common";

import { AccountRightsModule } from "../account-rights/index.js";
import { AccountsModule } from "../accounts/index.js";
import { ReadingActivityModule } from "../reading-activity/index.js";
import { ListProductHoldersController } from "./features/list-product-holders/list-product-holders.controller.js";

/**
 * Who learns a Product: reads over Product Access and Reading Activity for the admin. It owns
 * no table and no right of its own, and no Module imports it (ADR 0029). Each read is one slice
 * under `features/`; the API process imports the Module.
 */
@Module({
  imports: [AccountsModule, AccountRightsModule, ReadingActivityModule],
  controllers: [ListProductHoldersController],
})
export class ProductLearnersModule {}
