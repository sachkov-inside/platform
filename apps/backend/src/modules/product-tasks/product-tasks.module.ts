import { MemberNames, MemberProfilesModule } from "../member-profiles/index.js";
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
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
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
  assembleProductTaskImport,
  PRODUCT_TASK_IMPORT,
  type ProductTaskImport,
} from "./facets/product-task-import/product-task-import.js";

@Module({
  imports: [
    PrismaModule,
    AssetsModule,
    ObjectStorageModule,
    AccountsModule,
    MaterialContentModule,
    MaterialsModule,
    TelegramAccountLinksModule,
    MemberProfilesModule,
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
        PUBLISHED_MATERIAL_READER,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        contentAccess: ContentAccess,
        config: PlatformConfig,
        materialAssets: MaterialAssets,
        materialReader: PublishedMaterialReader,
      ): LearningTasks =>
        assembleLearningTasks({
          prisma,
          directory,
          contentAccess,
          materialAssets,
          materialReader,
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
        return assembleProductTaskImport({
          assets,
          prisma,
          directory,
          authorPolicy: {
            canManage: (accountId: string) =>
              permissions.hasMaterialsManage(checkedAccountId(accountId)),
          },
        });
      },
    },
    {
      provide: SUBMISSION_REVIEW,
      inject: [
        PrismaClientProvider,
        ProductDirectory,
        ACCOUNTS,
        TelegramAccountLinks,
        MemberNames,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: ProductDirectory,
        accounts: Accounts,
        identities: TelegramAccountLinks,
        names: MemberNames,
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
          names,
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
