import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import type { AuthorPolicy } from "./ports/author-policy.js";
import { assembleBaselineContentAccess } from "./ports/content-access.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "./facets/published-material-reader/published-material-reader.js";
import { assemblePublishedMaterialReader } from "./facets/published-material-reader/assemble-published-material-reader.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

const publicReaderPolicy: AuthorPolicy = {
  canManage: () => false,
};

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: PUBLISHED_MATERIAL_READER,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): PublishedMaterialReader =>
        assemblePublishedMaterialReader({
          prisma,
          // Accounts replaces this baseline when it becomes a real
          // production dependency of published reading.
          contentAccess: assembleBaselineContentAccess(publicReaderPolicy),
          materialBodyOperations,
        }),
    },
  ],
  exports: [PUBLISHED_MATERIAL_READER],
})
export class MaterialsModule {}
