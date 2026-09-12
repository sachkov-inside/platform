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
