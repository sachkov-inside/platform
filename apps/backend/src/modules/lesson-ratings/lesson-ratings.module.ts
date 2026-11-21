import { Module } from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { ProductCatalogue, ProductsModule } from "../products/index.js";
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
  imports: [
    PrismaModule,
    AccountsModule,
    MaterialContentModule,
    ProductsModule,
  ],
  controllers: [LessonRatingsController, LessonRatingCountsController],
  exports: [LessonRatings],
  providers: [
    {
      provide: LessonRatings,
      inject: [
        PrismaClientProvider,
        CONTENT_ACCESS,
        ACCOUNTS,
        ProductCatalogue,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        accounts: Accounts,
        catalogue: ProductCatalogue,
        config: PlatformConfig,
      ) => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        return new LessonRatings({
          prisma,
          contentAccess,
          feedbackPolicy: {
            enabled:
              config.mode !== "production" ||
              config.lessonFeedbackRecipientAccountId !== undefined,
            hasActiveLessonPlacement: (id) =>
              catalogue.hasActiveLessonPlacement(id),
          },
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
