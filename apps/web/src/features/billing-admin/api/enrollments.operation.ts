import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  contentCatalogInputSchema,
  contentCatalogOutcomeSchema,
} from "../model/enrollment-operations";

/** Каталог продуктов и материалов для отзыва доступа: `content.list` владельца. */
export const readContentCatalogOperation = defineMutationOperation({
  input: contentCatalogInputSchema,
  method: "POST",
  path: "/api/authoring/billing/content/list",
  result: billingCommandResultSchema(contentCatalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
