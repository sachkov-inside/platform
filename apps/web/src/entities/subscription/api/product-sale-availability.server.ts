import "server-only";
import { z } from "zod";
import { requestProductSaleAvailability } from "@/shared/api/backend/index.server";

const availabilitySchema = z.strictObject({
  items: z
    .array(z.strictObject({ productId: z.uuid(), sold: z.boolean() }))
    .max(100),
});
const availabilityBatchSize = 100;

/** Sale admission shares the owning billing rules, but never reads a full programme or prices. */
export async function loadProductSaleAvailability(
  productIds: readonly string[],
  accessToken?: string,
): Promise<
  | { readonly kind: "ready"; readonly soldProductIds: ReadonlySet<string> }
  | { readonly kind: "unavailable" }
> {
  const parsedIds = z.array(z.uuid()).safeParse(productIds);
  if (!parsedIds.success) return { kind: "unavailable" };
  const uniqueIds = [...new Set(parsedIds.data.map((id) => id.toLowerCase()))];
  const soldProductIds = new Set<string>();
  try {
    for (
      let start = 0;
      start < uniqueIds.length;
      start += availabilityBatchSize
    ) {
      const batch = uniqueIds.slice(start, start + availabilityBatchSize);
      const response = await requestProductSaleAvailability(batch, accessToken);
      if (!response.ok) return { kind: "unavailable" };
      const parsed = availabilitySchema.safeParse(response.body);
      if (!parsed.success) return { kind: "unavailable" };
      const returned = new Set(parsed.data.items.map((item) => item.productId));
      if (
        returned.size !== batch.length ||
        parsed.data.items.length !== batch.length ||
        batch.some((id) => !returned.has(id))
      )
        return { kind: "unavailable" };
      for (const item of parsed.data.items)
        if (item.sold) soldProductIds.add(item.productId);
    }
    return { kind: "ready", soldProductIds };
  } catch {
    return { kind: "unavailable" };
  }
}
