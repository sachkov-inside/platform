import { Module } from "@nestjs/common";

import {
  MaterialsModule,
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../materials/index.js";
import {
  LIST_PUBLISHED_MATERIALS,
  type ListPublishedMaterials,
} from "./list-published-materials/list-published-materials.contract.js";
import { ListPublishedMaterialsController } from "./list-published-materials/list-published-materials.controller.js";
import { createListPublishedMaterialsOperation } from "./list-published-materials/list-published-materials.js";

@Module({
  imports: [MaterialsModule],
  controllers: [ListPublishedMaterialsController],
  providers: [
    {
      provide: LIST_PUBLISHED_MATERIALS,
      inject: [PUBLISHED_MATERIAL_READER],
      useFactory: (
        publishedMaterialReader: PublishedMaterialReader,
      ): ListPublishedMaterials =>
        createListPublishedMaterialsOperation({ publishedMaterialReader }),
    },
  ],
  exports: [LIST_PUBLISHED_MATERIALS],
})
export class ContentLibraryModule {}
