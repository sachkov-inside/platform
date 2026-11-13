import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import {
  MATERIAL_CONTENT,
  MaterialContentModule,
  materialBodyOperations,
  type MaterialContent,
} from "../materials/index.js";
import { ExerciseAttemptsController } from "./adapters/nest/exercise-attempts.controller.js";
import { ExerciseAttempts } from "./facets/exercise-attempts/exercise-attempts.js";

@Module({
  imports: [PrismaModule, AccountsModule, MaterialContentModule],
  controllers: [ExerciseAttemptsController],
  providers: [
    {
      provide: ExerciseAttempts,
      inject: [PrismaClientProvider, CONTENT_ACCESS, MATERIAL_CONTENT],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
      ) =>
        new ExerciseAttempts({
          prisma,
          contentAccess,
          materialContent,
          materialBodyOperations,
        }),
    },
  ],
})
export class ExerciseAttemptsModule {}
