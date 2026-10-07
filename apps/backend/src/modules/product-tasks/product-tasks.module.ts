import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  AccountsModule,
  accountId as checkedAccountId,
  type Accounts,
} from "../accounts/index.js";
import {
  assembleCurrentAccountPermissions,
  CONTENT_ACCESS,
  type ContentAccess,
} from "../content-access/index.js";
import {
  ProductDirectory,
  MaterialContentModule,
  MaterialsModule,
} from "../materials/index.js";
import {
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import {
  assembleLearningTasks,
  LEARNING_TASKS,
  type LearningTasks,
} from "./facets/learning-tasks/learning-tasks.js";
import {
  assembleSubmissionReview,
  SUBMISSION_REVIEW,
  type SubmissionReview,
} from "./facets/submission-review/submission-review.js";
import {
  PRODUCT_TASK_IMPORT,
  type ProductTaskImport,
} from "./features/import-product-task/import-product-task.controller.js";
import {
  assembleApplySourceTask,
  assembleValidateSourceTask,
} from "./features/import-product-task/import-product-task.js";

@Module({
  imports: [
    PrismaModule,
    AccountsModule,
    MaterialContentModule,
    MaterialsModule,
    TelegramAccountLinksModule,
  ],
  providers: [
    {
      provide: LEARNING_TASKS,
      inject: [
        PrismaClientProvider,
        ProductDirectory,
        CONTENT_ACCESS,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        contentAccess: ContentAccess,
        config: PlatformConfig,
      ): LearningTasks =>
        assembleLearningTasks({
          prisma,
          directory,
          contentAccess,
          submissionsEnabled: config.productTasks.submissionsEnabled,
        }),
    },
    {
      provide: PRODUCT_TASK_IMPORT,
      inject: [PrismaClientProvider, ProductDirectory, ACCOUNTS],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        accounts: Accounts,
      ): ProductTaskImport => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        const dependencies = {
          prisma,
          directory,
          authorPolicy: {
            canManage: (accountId: string) =>
              permissions.hasMaterialsManage(checkedAccountId(accountId)),
          },
        };
        return {
          validate: assembleValidateSourceTask(dependencies),
          apply: assembleApplySourceTask(dependencies),
        };
      },
    },
    {
      provide: SUBMISSION_REVIEW,
      inject: [
        PrismaClientProvider,
        ProductDirectory,
        ACCOUNTS,
        TelegramAccountLinks,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        accounts: Accounts,
        identities: TelegramAccountLinks,
      ): SubmissionReview => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        return assembleSubmissionReview({
          prisma,
          directory,
          authorPolicy: {
            canManage: (accountId: string) =>
              permissions.hasMaterialsManage(checkedAccountId(accountId)),
          },
          identities,
        });
      },
    },
  ],
  exports: [LEARNING_TASKS, PRODUCT_TASK_IMPORT, SUBMISSION_REVIEW],
})
export class ProductTasksModule {}
