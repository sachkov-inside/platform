import "server-only";
import { ownerCommand } from "./billing-admin.server";
import {
  saveProductPriceOperation,
  archiveProductPriceOperation,
} from "./product-prices.operation";
export function handleSaveProductPrice(request: Request) {
  return ownerCommand(request, saveProductPriceOperation, (input) => ({
    operationId: input.operationId,
    value: input.value,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision }),
    operation: "productPrices.save",
  }));
}
export function handleArchiveProductPrice(request: Request) {
  return ownerCommand(request, archiveProductPriceOperation, (input) => ({
    ...input,
    operation: "productPrices.archive",
  }));
}
