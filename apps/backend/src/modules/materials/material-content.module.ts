import { PublishedSeriesComposition } from "./facets/published-series-composition/published-series-composition.js";
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
    { provide: PublishedSeriesComposition, inject: [PrismaClientProvider], useFactory: (prisma: PrismaClientProvider) => new PublishedSeriesComposition(prisma) },
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
  exports: [MATERIAL_CONTENT, PublicContentTargets, PublishedSeriesComposition],
})
export class MaterialContentModule {}
