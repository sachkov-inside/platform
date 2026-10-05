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
  GuideDirectory,
  MaterialContentModule,
  MaterialsModule,
} from "../materials/index.js";
import {
  assembleLearningTasks,
  LEARNING_TASKS,
  type LearningTasks,
} from "./facets/learning-tasks/learning-tasks.js";
import {
  GUIDE_TASK_IMPORT,
  type GuideTaskImport,
} from "./features/import-guide-task/import-guide-task.controller.js";
import {
  assembleApplySourceTask,
  assembleValidateSourceTask,
} from "./features/import-guide-task/import-guide-task.js";

@Module({
  imports: [
    PrismaModule,
    AccountsModule,
    MaterialContentModule,
    MaterialsModule,
  ],
  providers: [
    {
      provide: LEARNING_TASKS,
      inject: [
        PrismaClientProvider,
        GuideDirectory,
        CONTENT_ACCESS,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: GuideDirectory,
        contentAccess: ContentAccess,
        config: PlatformConfig,
      ): LearningTasks =>
        assembleLearningTasks({
          prisma,
          directory,
          contentAccess,
          submissionsEnabled: config.guideTasks.submissionsEnabled,
        }),
    },
    {
      provide: GUIDE_TASK_IMPORT,
      inject: [PrismaClientProvider, GuideDirectory, ACCOUNTS],
      useFactory: (
        prisma: PrismaClientProvider,
        directory: GuideDirectory,
        accounts: Accounts,
      ): GuideTaskImport => {
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
  ],
  exports: [LEARNING_TASKS, GUIDE_TASK_IMPORT],
})
export class GuideTasksModule {}
