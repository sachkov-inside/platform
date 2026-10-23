import { ProductDiscovery } from "./facets/product-catalogue/product-discovery.js";
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
      provide: ProductDiscovery,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ProductDiscovery(prisma),
    },
    {
      provide: ProductCatalogue,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ProductCatalogue(prisma),
    },
  ],
  exports: [ProductCatalogue, ProductCoverSelection, ProductDiscovery],
})
export class ProductsModule {}
