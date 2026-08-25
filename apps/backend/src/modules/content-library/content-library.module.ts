import { Module } from "@nestjs/common";

import {
  MaterialsModule,
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../materials/index.js";
import { CONTENT_LIBRARY, type ContentLibrary } from "./content-library.interface.js";
import { createContentLibrary } from "./create-content-library.js";

@Module({
  imports: [MaterialsModule],
  providers: [
    {
      provide: CONTENT_LIBRARY,
      inject: [PUBLISHED_MATERIAL_READER],
      useFactory: (publishedMaterialReader: PublishedMaterialReader): ContentLibrary =>
        createContentLibrary({ publishedMaterialReader }),
    },
  ],
  exports: [CONTENT_LIBRARY],
})
export class ContentLibraryModule {}
