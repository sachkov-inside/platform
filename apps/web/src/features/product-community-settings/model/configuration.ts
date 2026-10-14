import { z } from "zod";
export const productCommunityConfigurationSchema = z.strictObject({
  productId: z.uuid(),
  groupRef: z.literal("primary").nullable(),
});
export const configuredProductCommunitySchema = z.strictObject({
  ok: z.literal(true),
});
