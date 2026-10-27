import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  executeReorderProduct,
  reorderProductInvalidInput,
} from "./reorder-product.server";
import { reorderProductOperation } from "./product-order.operation";

export function handleProductOrderRequest(request: Request): Promise<Response> {
  return handleMutationOperation(request, reorderProductOperation, {
    execute: (input, accessToken) => executeReorderProduct(input, accessToken),
    invalidInput: reorderProductInvalidInput,
  });
}
