import {
  AssetsModule,
  MATERIAL_ASSETS,
  type MaterialAssets,
} from "../assets/index.js";
import {
  ObjectStorageModule,
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import {
  TASK_ASSET_DELIVERY,
  deliverTaskAsset,
  type TaskAssetDelivery,
} from "./features/deliver-task-asset/deliver-task-asset.js";
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
    AssetsModule,
    ObjectStorageModule,
    AccountsModule,
    MaterialContentModule,
    MaterialsModule,
    TelegramAccountLinksModule,
  ],
  providers: [
    {
      provide: TASK_ASSET_DELIVERY,
      inject: [
        PrismaClientProvider,
        ProductDirectory,
        CONTENT_ACCESS,
        PLATFORM_CONFIG,
        MATERIAL_ASSETS,
        OBJECT_STORAGE,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        contentAccess: ContentAccess,
        config: PlatformConfig,
        assets: MaterialAssets,
        objectStorage: ObjectStorage,
      ): TaskAssetDelivery => ({
        deliver: (input) =>
          deliverTaskAsset(
            {
              prisma,
              directory,
              contentAccess,
              assets,
              objectStorage,
              submissionsEnabled: config.productTasks.submissionsEnabled,
            },
            input,
          ),
      }),
    },
    {
      provide: LEARNING_TASKS,
      inject: [
        PrismaClientProvider,
        ProductDirectory,
        CONTENT_ACCESS,
        PLATFORM_CONFIG,
        MATERIAL_ASSETS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        contentAccess: ContentAccess,
        config: PlatformConfig,
        materialAssets: MaterialAssets,
      ): LearningTasks =>
        assembleLearningTasks({
          prisma,
          directory,
          contentAccess,
          materialAssets,
          submissionsEnabled: config.productTasks.submissionsEnabled,
        }),
    },
    {
      provide: PRODUCT_TASK_IMPORT,
      inject: [
        PrismaClientProvider,
        ProductDirectory,
        ACCOUNTS,
        MATERIAL_ASSETS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        accounts: Accounts,
        assets: MaterialAssets,
      ): ProductTaskImport => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        const dependencies = {
          assets,
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
  exports: [
    TASK_ASSET_DELIVERY,
    LEARNING_TASKS,
    PRODUCT_TASK_IMPORT,
    SUBMISSION_REVIEW,
  ],
})
export class ProductTasksModule {}
