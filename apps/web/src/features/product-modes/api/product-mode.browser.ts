import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import type { ProductMode } from "@/shared/product-mode";

export async function saveReaderProductMode(productMode: ProductMode) {
  const form = new FormData();
  form.set("productMode", productMode);
  const result = await requestSameOriginMutation(
    "/api/reading-progress/product-mode",
    "PUT",
    form,
  );
  return result.ok
    ? ({ kind: "saved" } as const)
    : ({ kind: "unavailable" } as const);
}
