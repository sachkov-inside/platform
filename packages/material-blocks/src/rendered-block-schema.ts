import { z } from "zod";

import type { RenderedBlockVariantSchema } from "./block-definition.js";
import { materialBlockDefinitions } from "./registry.js";
import type { RenderedBlock, RenderedMaterialBody } from "./rendered-block.js";

function registryVariants(
  block: z.ZodType<RenderedBlock>,
): [RenderedBlockVariantSchema, ...RenderedBlockVariantSchema[]] {
  const [first, ...rest] = materialBlockDefinitions;
  return [
    first.renderedSchema(block),
    ...rest.map((definition) => definition.renderedSchema(block)),
  ];
}

/** The rendered shape of a material body block, derived from the registry. */
export const renderedBlockSchema: z.ZodType<RenderedBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", registryVariants(renderedBlockSchema)),
);

export const renderedMaterialBodySchema: z.ZodType<RenderedMaterialBody> = z
  .object({ blocks: z.array(renderedBlockSchema), schemaVersion: z.literal(1) })
  .strict();

/**
 * The same recursive union with variants a published transport contract still enumerates but
 * the registry no longer produces. Only a wire boundary needs this; the reading client and the
 * domain use `renderedBlockSchema`.
 */
export function extendedRenderedBlockSchema(
  additionalVariants: readonly z.core.$ZodTypeDiscriminable<"kind">[],
): z.ZodType {
  const schema: z.ZodType<RenderedBlock> = z.lazy(() => {
    const union = z.discriminatedUnion("kind", [
      ...registryVariants(schema),
      ...additionalVariants,
    ]);
    // Only the published enumeration is wider: the recursive reference keeps the registry's
    // block type, because nothing in the platform produces the extra variants.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return union as unknown as z.ZodType<RenderedBlock>;
  });
  return schema;
}
