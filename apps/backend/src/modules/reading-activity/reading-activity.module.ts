import { PersonalHome } from "./facets/personal-home/personal-home.js";
import { RecordMaterialOpenController } from "./features/record-material-open/record-material-open.controller.js";
import { GetContinueMaterialsController } from "./features/get-continue-materials/get-continue-materials.controller.js";
import { VIDEOS, VideosModule, type Videos } from "../videos/index.js";
import { PublishedMaterialSelection } from "../materials/index.js";
import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import { MATERIAL_CONTENT, MaterialContentModule, MaterialsModule, PublishedSeriesComposition, type MaterialContent } from "../materials/index.js";
import { ReadingActivityController } from "./adapters/nest/reading-activity.controller.js";
import { ReadingActivity } from "./facets/reading-activity/reading-activity.js";

@Module({
  imports: [VideosModule, PrismaModule, AccountsModule, MaterialsModule, MaterialContentModule],
  controllers: [ReadingActivityController, RecordMaterialOpenController, GetContinueMaterialsController],
  providers: [{
    provide: PersonalHome,
    inject: [PrismaClientProvider, CONTENT_ACCESS, MATERIAL_CONTENT, PublishedMaterialSelection, VIDEOS],
    useFactory: (prisma: PrismaClientProvider, contentAccess: ContentAccess, materialContent: MaterialContent, selection: PublishedMaterialSelection, videos: Videos) => new PersonalHome({ prisma, contentAccess, materialContent, selection, videos }),
  }, {
    provide: ReadingActivity,
    inject: [PrismaClientProvider, CONTENT_ACCESS, MATERIAL_CONTENT, PublishedSeriesComposition],
    useFactory: (prisma: PrismaClientProvider, contentAccess: ContentAccess, materialContent: MaterialContent, composition: PublishedSeriesComposition) =>
      new ReadingActivity({ prisma, contentAccess, materialContent, composition }),
  }],
})
export class ReadingActivityModule {}
