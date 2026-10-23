import { Module } from "@nestjs/common";
import {
  PrismaModule,
  PrismaClientProvider,
} from "../../infrastructure/prisma/index.js";
import {
  PRODUCT_MATERIAL_READING,
  type ProductMaterialReading,
} from "./ports/product-material-reading.js";
import { ProductCompositionsReading } from "./facets/product-compositions-reading/product-compositions-reading.js";
import { ProductDirectory } from "./features/read-product-directory/read-product-directory.js";
import { ProductOutlines } from "./features/list-product-outlines/list-product-outlines.js";
import { PublishedSeriesComposition } from "./features/read-published-series-composition/read-published-series-composition.js";
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: ProductCompositionsReading,
      inject: [PrismaClientProvider, PRODUCT_MATERIAL_READING],
      useFactory: (
        prisma: PrismaClientProvider,
        materials: ProductMaterialReading,
      ) => new ProductCompositionsReading(prisma, materials),
    },
    {
      provide: ProductDirectory,
      inject: [
        PrismaClientProvider,
        PRODUCT_MATERIAL_READING,
        ProductCompositionsReading,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        materials: ProductMaterialReading,
        compositions: ProductCompositionsReading,
      ) => new ProductDirectory(prisma, materials, compositions),
    },
    {
      provide: ProductOutlines,
      inject: [
        PrismaClientProvider,
        PRODUCT_MATERIAL_READING,
        ProductCompositionsReading,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        materials: ProductMaterialReading,
        compositions: ProductCompositionsReading,
      ) => new ProductOutlines(prisma, materials, compositions),
    },
    {
      provide: PublishedSeriesComposition,
      inject: [
        PrismaClientProvider,
        PRODUCT_MATERIAL_READING,
        ProductCompositionsReading,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        materials: ProductMaterialReading,
        compositions: ProductCompositionsReading,
      ) => new PublishedSeriesComposition(prisma, materials, compositions),
    },
  ],
  exports: [
    ProductDirectory,
    ProductOutlines,
    PublishedSeriesComposition,
    ProductCompositionsReading,
  ],
})
export class ProductReadingModule {}
