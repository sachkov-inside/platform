import type { ProductMode } from "@/shared/product-mode";

import { saveReaderProductModeOperation } from "./product-mode.operation";

export function saveReaderProductMode(productMode: ProductMode) {
  return saveReaderProductModeOperation.send({ productMode });
}
