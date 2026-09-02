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
  providers: [{
    provide: MATERIAL_CONTENT,
    inject: [PrismaClientProvider],
    useFactory: (prisma: PrismaClientProvider): MaterialContent =>
      assembleMaterialContent({ prisma, materialBodyOperations }),
  }],
  exports: [MATERIAL_CONTENT],
})
export class MaterialContentModule {}
