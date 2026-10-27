import "server-only";
import { requestProductContinuation } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  continuationLabel,
  productContinuationProjectionSchema,
  type ProductContinuationView,
} from "../model/product-continuation-contract";
import { loadProductContinuationOperation } from "./reading-progress.operation";
export async function getProductContinuation(
  slug: string,
  token: string,
): Promise<ProductContinuationView> {
  try {
    const response = await requestProductContinuation(slug, token);
    if (!response.ok)
      return {
        kind: response.response.status === 401 ? "hidden" : "unavailable",
      };
    const parsed = productContinuationProjectionSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.collection.slug !== slug)
      return { kind: "unavailable" };
    const { read, total, continuation, started } = parsed.data;
    return {
      kind: "ready",
      ...(started === undefined ? {} : { started }),
      read,
      total,
      continuation:
        continuation === null
          ? null
          : {
              materialSlug: continuation.materialSlug,
              label: continuationLabel(continuation.resume),
            },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
export function handleProductContinuation(request: Request) {
  return handleMutationOperation(request, loadProductContinuationOperation, {
    // A slug outside the schema reads as unavailable, as the browser saw it before.
    invalidInput: () => ({ kind: "unavailable" }) as const,
    execute: (input, token) => getProductContinuation(input.slug, token),
  });
}
