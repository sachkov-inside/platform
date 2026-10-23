import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ProductCatalogue } from "./facets/product-catalogue/product-catalogue.js";
import { ProductCoverSelection } from "./adapters/product-cover-selection.js";

@Module({
  imports: [PrismaModule],
  providers: [
    ProductCoverSelection,
    {
      provide: ProductCatalogue,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ProductCatalogue(prisma),
    },
  ],
  exports: [ProductCatalogue, ProductCoverSelection],
})
export class ProductsModule {}
