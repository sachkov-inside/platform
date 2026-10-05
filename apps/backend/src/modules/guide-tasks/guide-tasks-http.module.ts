import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/index.js";
import { ImportGuideTaskController } from "./features/import-guide-task/import-guide-task.controller.js";
import { GuideTasksModule } from "./guide-tasks.module.js";

/** The HTTP surface of Guide Tasks; the API process imports it. */
@Module({
  imports: [AccountsModule, GuideTasksModule],
  controllers: [ImportGuideTaskController],
})
export class GuideTasksHttpModule {}
