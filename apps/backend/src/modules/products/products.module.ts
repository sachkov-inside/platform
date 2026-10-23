import {
  ProductMemberships,
  PRODUCT_MEMBERSHIPS,
} from "./facets/product-memberships/product-memberships.js";
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
    {
      provide: PRODUCT_MEMBERSHIPS,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new ProductMemberships(prisma),
    },
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
  exports: [
    PRODUCT_MEMBERSHIPS,
    ProductCatalogue,
    ProductCoverSelection,
    ProductDiscovery,
  ],
})
export class ProductsModule {}
