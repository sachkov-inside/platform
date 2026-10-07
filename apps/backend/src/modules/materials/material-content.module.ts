import { ProductOutlines } from "./features/list-product-outlines/list-product-outlines.js";
import { ProductDirectory } from "./features/read-product-directory/read-product-directory.js";
import { CoverageCatalog } from "./facets/coverage-catalog/coverage-catalog.js";
import { PublishedMaterialSelection } from "./features/select-published-materials/select-published-materials.js";
import { PublishedSeriesComposition } from "./features/read-published-series-composition/read-published-series-composition.js";
import { PublicContentTargets } from "./facets/public-content-targets/public-content-targets.js";
import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  assembleMaterialContent,
  MATERIAL_CONTENT,
  type MaterialContent,
} from "./facets/material-content/material-content.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: CoverageCatalog,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) => new CoverageCatalog(prisma),
    },
    {
      provide: PublishedMaterialSelection,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new PublishedMaterialSelection(prisma),
    },
    {
      provide: PublishedSeriesComposition,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new PublishedSeriesComposition(prisma),
    },
    {
      provide: ProductOutlines,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) => new ProductOutlines(prisma),
    },
    {
      provide: ProductDirectory,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ProductDirectory(prisma),
    },
    {
      provide: PublicContentTargets,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new PublicContentTargets(prisma),
    },
    {
      provide: MATERIAL_CONTENT,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): MaterialContent =>
        assembleMaterialContent({ prisma, materialBodyOperations }),
    },
  ],
  exports: [
    CoverageCatalog,
    ProductDirectory,
    ProductOutlines,
    MATERIAL_CONTENT,
    PublicContentTargets,
    PublishedSeriesComposition,
    PublishedMaterialSelection,
  ],
})
export class MaterialContentModule {}
