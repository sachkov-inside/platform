import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productsTransaction } from "../../infrastructure/transaction.js";
import { ProductCompositions } from "../product-compositions/product-compositions.js";
import type { ProductMaterialReading } from "../../ports/product-material-reading.js";
import { compositionMaterialFacts } from "../../shared/material-reading-facts.js";

/** Complete Product composition over Products structure and Materials-owned publication facts. */
export class ProductCompositionsReading {
  constructor(
    private readonly prisma: Pick<ProductsPrismaClient, "$queryRaw">,
    private readonly materials: ProductMaterialReading,
  ) {}
  load(
    filter: Parameters<ProductCompositions["load"]>[0],
    limit: number,
    handle?: TransactionHandle,
  ) {
    return new ProductCompositions(
      handle === undefined ? this.prisma : productsTransaction(handle),
    ).load(filter, limit, compositionMaterialFacts(this.materials, handle));
  }
}
