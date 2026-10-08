import { DeliverTaskAssetController } from "./features/deliver-task-asset/deliver-task-asset.controller.js";
import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/index.js";
import { ImportProductTaskController } from "./features/import-product-task/import-product-task.controller.js";
import { ListAuthorSubmissionsController } from "./features/list-author-submissions/list-author-submissions.controller.js";
import { ListOwnTaskSubmissionsController } from "./features/list-task-submissions/list-task-submissions.controller.js";
import { ReadTaskPageController } from "./features/read-task-page/read-task-page.controller.js";
import { SaveAuthorFeedbackController } from "./features/save-author-feedback/save-author-feedback.controller.js";
import { SubmitTaskFormController } from "./features/submit-task/submit-task-form.controller.js";
import { ProductTasksModule } from "./product-tasks.module.js";

/**
 * The HTTP surface of Product Tasks: the authoring import and the author's «Сдачи» section
 * (#948), and the task page, own submissions and the page form for learners (#947). The API process imports it; it re-exports the module so the Product
 * programme read reaches the chapter tasks.
 */
@Module({
  imports: [AccountsModule, ProductTasksModule],
  controllers: [
    ImportProductTaskController,
    ReadTaskPageController,
    DeliverTaskAssetController,
    ListOwnTaskSubmissionsController,
    SubmitTaskFormController,
    ListAuthorSubmissionsController,
    SaveAuthorFeedbackController,
  ],
  exports: [ProductTasksModule],
})
export class ProductTasksHttpModule {}
