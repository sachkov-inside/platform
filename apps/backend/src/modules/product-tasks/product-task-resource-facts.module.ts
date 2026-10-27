import { ProductsModule, ProductDiscovery } from "../products/index.js";
import { Global, Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  PRODUCT_TASK_RESOURCE_FACTS,
  type ProductTaskResourceFactsAdapter,
} from "../content-access/index.js";
import { assembleProductTaskResourceFacts } from "./adapters/content-access/product-task-resource-facts.js";

/**
 * Product Tasks' implementation of the Content Access Product Task port. Global, because Materials
 * assembles Content Access and must not import Product Tasks (ADR 0029); each process that loads
 * Materials imports this module in its entrypoint.
 */
@Global()
@Module({
  imports: [PrismaModule, ProductsModule],
  providers: [
    {
      provide: PRODUCT_TASK_RESOURCE_FACTS,
      inject: [PrismaClientProvider, ProductDiscovery],
      useFactory: (
        prisma: PrismaClientProvider,
        products: ProductDiscovery,
      ): ProductTaskResourceFactsAdapter =>
        assembleProductTaskResourceFacts(prisma, products),
    },
  ],
  exports: [PRODUCT_TASK_RESOURCE_FACTS],
})
export class ProductTaskResourceFactsModule {}
