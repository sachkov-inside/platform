import { z } from "zod";
import type { OpenAPIObject, SchemaObject } from "@nestjs/swagger";

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

/**
 * Nest accepts inline SchemaObjects but cannot lift Zod's recursive `definitions`
 * from those objects. Normalize them once at the Zod/OpenAPI adapter boundary so
 * generated clients receive concrete recursive component schemas.
 */
export function hoistZodRecursiveSchemas(document: OpenAPIObject): void {
  const schemas = (document.components ??= {}).schemas ??= {};
  let group = 0;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    const definitions = value.definitions;
    if (isRecord(definitions)) {
      const names = new Map(
        Object.keys(definitions).map((name) => [
          name,
          `RecursiveSchema${String(group)}${name.replaceAll(/[^a-z0-9]/giu, "")}`,
        ]),
      );
      group += 1;
      rewriteDefinitionReferences(value, names);
      for (const [name, schema] of Object.entries(definitions)) {
        const componentName = names.get(name);
        if (componentName !== undefined && isRecord(schema)) {
          schemas[componentName] = schema;
        }
      }
      delete value.definitions;
    }
    Object.values(value).forEach(visit);
  };

  visit(document.paths);
}

function rewriteDefinitionReferences(
  value: unknown,
  names: ReadonlyMap<string, string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteDefinitionReferences(item, names));
    return;
  }
  if (!isRecord(value)) return;
  const reference = value.$ref;
  if (typeof reference === "string" && reference.startsWith("#/definitions/")) {
    const componentName = names.get(reference.slice("#/definitions/".length));
    if (componentName !== undefined) {
      value.$ref = `#/components/schemas/${componentName}`;
    }
  }
  Object.values(value).forEach((item) => rewriteDefinitionReferences(item, names));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
