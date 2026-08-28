import { z } from "zod";
import type { SchemaObject } from "@nestjs/swagger";

export function toOpenApiSchema(schema: z.ZodType): SchemaObject {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    unrepresentable: "any",
  });

  // Zod emits the OpenAPI 3.0 schema dialect requested above. Nest exposes the
  // same wire shape through a narrower, separately maintained TypeScript type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return jsonSchema as SchemaObject;
}

export function problemDetailsContent(schema: z.ZodType) {
  return {
    "application/problem+json": { schema: toOpenApiSchema(schema) },
  } as const;
}

export function problemDetailsOneOfContent(
  ...schemas: readonly z.ZodType[]
) {
  return {
    "application/problem+json": {
      schema: { oneOf: schemas.map(toOpenApiSchema) },
    },
  } as const;
}
