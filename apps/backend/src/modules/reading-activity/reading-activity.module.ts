import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import { MATERIAL_CONTENT, MaterialContentModule, MaterialsModule, PublishedSeriesComposition, type MaterialContent } from "../materials/index.js";
import { ReadingActivityController } from "./adapters/nest/reading-activity.controller.js";
import { ReadingActivity } from "./facets/reading-activity/reading-activity.js";

@Module({
  imports: [PrismaModule, AccountsModule, MaterialsModule, MaterialContentModule],
  controllers: [ReadingActivityController],
  providers: [{
    provide: ReadingActivity,
    inject: [PrismaClientProvider, CONTENT_ACCESS, MATERIAL_CONTENT, PublishedSeriesComposition],
    useFactory: (prisma: PrismaClientProvider, contentAccess: ContentAccess, materialContent: MaterialContent, composition: PublishedSeriesComposition) =>
      new ReadingActivity({ prisma, contentAccess, materialContent, composition }),
  }],
})
export class ReadingActivityModule {}
