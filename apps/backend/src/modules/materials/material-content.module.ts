import { ProductDiscovery, ProductsModule } from "../products/index.js";
import { PublicMaterialAnnouncements } from "./facets/public-material-announcements/public-material-announcements.js";
import { CoverageCatalog } from "./facets/coverage-catalog/coverage-catalog.js";
import { PublishedMaterialSelection } from "./features/select-published-materials/select-published-materials.js";
import { PublicContentTargets } from "./facets/public-content-targets/public-content-targets.js";
import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  assembleMaterialContent,
  MATERIAL_PUBLICATION,
  type MaterialContent,
} from "./facets/material-content/material-content.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

@Module({
  imports: [PrismaModule, ProductsModule],
  providers: [
    {
      provide: PublicMaterialAnnouncements,
      inject: [PrismaClientProvider, ProductDiscovery],
      useFactory: (prisma: PrismaClientProvider, products: ProductDiscovery) =>
        new PublicMaterialAnnouncements(prisma, products),
    },
    {
      provide: CoverageCatalog,
      inject: [PrismaClientProvider, ProductDiscovery],
      useFactory: (prisma: PrismaClientProvider, products: ProductDiscovery) =>
        new CoverageCatalog(prisma, products),
    },
    {
      provide: PublishedMaterialSelection,
      inject: [PrismaClientProvider, ProductDiscovery],
      useFactory: (prisma: PrismaClientProvider, products: ProductDiscovery) =>
        new PublishedMaterialSelection({ prisma, products }),
    },
    {
      provide: PublicContentTargets,
      inject: [PrismaClientProvider, ProductDiscovery],
      useFactory: (prisma: PrismaClientProvider, products: ProductDiscovery) =>
        new PublicContentTargets(prisma, products),
    },
    {
      provide: MATERIAL_PUBLICATION,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): MaterialContent =>
        assembleMaterialContent({ prisma, materialBodyOperations }),
    },
  ],
  exports: [
    PublicMaterialAnnouncements,
    CoverageCatalog,
    MATERIAL_PUBLICATION,
    PublicContentTargets,
    PublishedMaterialSelection,
  ],
})
export class MaterialContentModule {}
