import type { ProductContinuationView } from "../model/product-continuation-contract";
import { loadProductContinuationOperation } from "./reading-progress.operation";

export function loadProductContinuation(
  slug: string,
): Promise<ProductContinuationView> {
  return loadProductContinuationOperation.send({ slug });
}
