import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";
import { productModeSchema } from "@/shared/product-mode";

/** Saves the signed-in reader's Product mode; a guest keeps it in a cookie instead. */
export const saveReaderProductModeOperation = defineMutationOperation({
  input: z.object({ productMode: productModeSchema }),
  method: "PUT",
  path: "/api/reading-progress/product-mode",
  // Читатель видит только «сохранено» или «недоступно»: любой ответ маршрута значит, что запрос дошёл.
  result: z
    .unknown()
    .transform((): { readonly kind: "saved" | "unavailable" } => ({
      kind: "saved",
    })),
  transportFailure: () => ({ kind: "unavailable" }) as const,
});
