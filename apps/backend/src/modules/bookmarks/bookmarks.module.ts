import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import { MaterialContentModule, MaterialsModule, PublishedMaterialSelection } from "../materials/index.js";
import { VIDEOS, VideosModule, type Videos } from "../videos/index.js";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { BookmarksController } from "./adapters/nest/bookmarks.controller.js";
import { Bookmarks } from "./facets/bookmarks/bookmarks.js";

@Module({
  imports: [PrismaModule, AccountsModule, MaterialsModule, MaterialContentModule, VideosModule],
  controllers: [BookmarksController],
  providers: [{
    provide: Bookmarks,
    inject: [PrismaClientProvider, CONTENT_ACCESS, PublishedMaterialSelection, VIDEOS],
    useFactory: (
      prisma: PrismaClientProvider,
      contentAccess: ContentAccess,
      selection: PublishedMaterialSelection,
      videos: Videos,
    ) => new Bookmarks({ prisma, contentAccess, selection, videos }),
  }],
})
export class BookmarksModule {}
