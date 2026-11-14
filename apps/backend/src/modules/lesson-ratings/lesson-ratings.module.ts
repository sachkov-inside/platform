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
import { MaterialContentModule } from "../materials/index.js";
import { LessonRatingCountsController } from "./adapters/nest/lesson-rating-counts.controller.js";
import { LessonRatingsController } from "./adapters/nest/lesson-ratings.controller.js";
import { LessonRatings } from "./facets/lesson-ratings/lesson-ratings.js";

/** «Как вам урок?» (#2124). CONTENT_ACCESS comes with the Material content composition. */
@Module({
  imports: [PrismaModule, AccountsModule, MaterialContentModule],
  controllers: [LessonRatingsController, LessonRatingCountsController],
  providers: [
    {
      provide: LessonRatings,
      inject: [PrismaClientProvider, CONTENT_ACCESS, ACCOUNTS],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        accounts: Accounts,
      ) => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        return new LessonRatings({
          prisma,
          contentAccess,
          authorPolicy: {
            canManage: (actor) =>
              permissions.hasMaterialsManage(accountId(actor)),
          },
        });
      },
    },
  ],
})
export class LessonRatingsModule {}
