import type { PlatformPrisma } from "../../infrastructure/prisma/index.js";
import { ProductDiscovery } from "../../modules/products/index.js";
import {
  assembleCreateProductIntake,
  type CreateProductIntakeOperation,
} from "../../modules/sales-funnel/index.js";

/** Trusted process composition; it creates no HTTP or user-facing administrative surface. */
export function assembleProductIntakeCreation({
  prisma,
}: {
  readonly prisma: PlatformPrisma;
}): CreateProductIntakeOperation {
  return assembleCreateProductIntake({
    prisma,
    products: new ProductDiscovery(prisma),
  });
}
