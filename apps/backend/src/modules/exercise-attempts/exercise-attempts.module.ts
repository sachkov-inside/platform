import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  AccountsModule,
  accountId,
  type Accounts,
} from "../accounts/index.js";
import {
  CONTENT_ACCESS,
  assembleCurrentAccountPermissions,
  type ContentAccess,
} from "../content-access/index.js";
import {
  MATERIAL_CONTENT,
  MaterialContentModule,
  materialBodyOperations,
  type MaterialContent,
} from "../materials/index.js";
import { ExerciseAttemptsController } from "./adapters/nest/exercise-attempts.controller.js";
import { ExerciseStatisticsController } from "./adapters/nest/exercise-statistics.controller.js";
import { ExerciseAttempts } from "./facets/exercise-attempts/exercise-attempts.js";

@Module({
  imports: [PrismaModule, AccountsModule, MaterialContentModule],
  controllers: [ExerciseAttemptsController, ExerciseStatisticsController],
  providers: [
    {
      provide: ExerciseAttempts,
      inject: [
        PrismaClientProvider,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        ACCOUNTS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        accounts: Accounts,
      ) => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        return new ExerciseAttempts({
          prisma,
          contentAccess,
          materialContent,
          materialBodyOperations,
          authorPolicy: {
            canManage: (actor) =>
              permissions.hasMaterialsManage(accountId(actor)),
          },
        });
      },
    },
  ],
})
export class ExerciseAttemptsModule {}
