import { ReadingActivityRetention } from "./features/retain-activity/retain-activity.js";
import { ReadingActivityFacts } from "./features/read-confirmed-activity/read-confirmed-activity.js";
import { ProductReadingModule } from "../products/index.js";
import { MaterialFirstOpens } from "./features/list-first-opens/list-first-opens.js";
import { GetLearningHomeController } from "./features/get-learning-home/get-learning-home.controller.js";
import { GetProductContinuationController } from "./features/get-product-continuation/get-product-continuation.controller.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../materials/index.js";
import { PersonalHome } from "./facets/personal-home/personal-home.js";
import { RecordMaterialOpenController } from "./features/record-material-open/record-material-open.controller.js";
import { GetContinueMaterialsController } from "./features/get-continue-materials/get-continue-materials.controller.js";
import { VIDEOS, VideosModule, type Videos } from "../videos/index.js";
import { PublishedMaterialSelection } from "../materials/index.js";
import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import { PublishedProductComposition } from "../products/index.js";
import {
  MATERIAL_CONTENT,
  MaterialContentModule,
  MaterialsModule,
  type MaterialContent,
} from "../materials/index.js";
import { ReadingActivityController } from "./adapters/nest/reading-activity.controller.js";
import { ReadingActivity } from "./facets/reading-activity/reading-activity.js";

@Module({
  imports: [
    ProductReadingModule,
    VideosModule,
    PrismaModule,
    AccountsModule,
    MaterialsModule,
    MaterialContentModule,
  ],
  controllers: [
    GetLearningHomeController,
    GetProductContinuationController,
    ReadingActivityController,
    RecordMaterialOpenController,
    GetContinueMaterialsController,
  ],
  providers: [
    {
      provide: ReadingActivityRetention,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ReadingActivityRetention(prisma),
    },
    {
      provide: ReadingActivityFacts,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ReadingActivityFacts(prisma),
    },
    {
      provide: MaterialFirstOpens,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new MaterialFirstOpens(prisma),
    },
    {
      provide: PersonalHome,
      inject: [
        PrismaClientProvider,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        PublishedMaterialSelection,
        VIDEOS,
        PUBLISHED_MATERIAL_READER,
        PublishedProductComposition,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        selection: PublishedMaterialSelection,
        videos: Videos,
        reader: PublishedMaterialReader,
        composition: PublishedProductComposition,
      ) =>
        new PersonalHome({
          prisma,
          contentAccess,
          materialContent,
          selection,
          videos,
          reader,
          composition,
        }),
    },
    {
      provide: ReadingActivity,
      inject: [
        PrismaClientProvider,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        PublishedProductComposition,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        composition: PublishedProductComposition,
      ) =>
        new ReadingActivity({
          prisma,
          contentAccess,
          materialContent,
          composition,
        }),
    },
  ],
  exports: [ReadingActivityRetention, ReadingActivityFacts, MaterialFirstOpens],
})
export class ReadingActivityModule {}
