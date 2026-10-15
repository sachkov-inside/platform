import { z } from "zod";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import { tierSnapshotSchema } from "../../domain/tariff-assignment.js";

const snapshotShape = z.toJSONSchema(tierSnapshotSchema, {
  unrepresentable: "any",
});
type Shape = z.core.JSONSchema.JSONSchema | boolean;

/**
 * A conservative database prefilter, never the final snapshot validator. Zod owns the shape;
 * unsupported shapes fall back to bounded candidate traversal and the complete owner codec.
 */
export function knownTimedSnapshot(): Prisma.Sql {
  const snapshot = Prisma.sql`candidate.snapshot`;
  const benefits = arrayValue(Prisma.sql`${snapshot}->'benefits'`);
  const periods = arrayValue(Prisma.sql`${snapshot}->'benefitPeriods'`);
  const products = arrayValue(
    Prisma.sql`${snapshot}->'coverage'->'productIds'`,
  );
  const materials = arrayValue(
    Prisma.sql`${snapshot}->'coverage'->'materialIds'`,
  );
  return Prisma.sql`(
    ${matchesSnapshotShape(snapshot, snapshotShape)}
    AND ${snapshot} ? 'benefitPeriods'
    AND (SELECT count(*) = count(DISTINCT value) FROM (SELECT jsonb_array_elements(${benefits}) AS value) AS entries)
    AND (SELECT count(*) = count(DISTINCT value->'capability') FROM (SELECT jsonb_array_elements(${periods}) AS value) AS entries)
    AND NOT EXISTS (SELECT 1 FROM (SELECT jsonb_array_elements(${periods}) AS value) AS term
      WHERE NOT (${benefits} @> jsonb_build_array(term.value->'capability')))
    AND (SELECT count(*) = count(DISTINCT value) FROM (SELECT jsonb_array_elements(${products}) AS value) AS entries)
    AND (SELECT count(*) = count(DISTINCT value) FROM (SELECT jsonb_array_elements(${materials}) AS value) AS entries)
    AND (NOT (${snapshot}->'coverage' @> '{"wholePlatform":true}'::jsonb)
      OR (jsonb_array_length(${products}) = 0 AND jsonb_array_length(${materials}) = 0))
  )`;
}

function arrayValue(value: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${value} ELSE '[]'::jsonb END`;
}

function matchesSnapshotShape(value: Prisma.Sql, shape: Shape): Prisma.Sql {
  if (typeof shape === "boolean") return Prisma.sql`false`;
  const supported = new Set([
    "$schema",
    "~standard",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "anyOf",
    "const",
    "enum",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "items",
  ]);
  if (Object.keys(shape).some((key) => !supported.has(key)))
    return Prisma.sql`false`;
  if (shape.anyOf !== undefined)
    return Prisma.sql`(${Prisma.join(
      shape.anyOf.map((part) => matchesSnapshotShape(value, part)),
      " OR ",
    )})`;
  if (shape.const !== undefined)
    return Prisma.sql`${value} = ${JSON.stringify(shape.const)}::jsonb`;
  if (shape.enum !== undefined)
    return Prisma.sql`(${Prisma.join(
      shape.enum.map(
        (entry) => Prisma.sql`${value} = ${JSON.stringify(entry)}::jsonb`,
      ),
      " OR ",
    )})`;
  if (shape.type === "null") return Prisma.sql`${value} = 'null'::jsonb`;
  if (shape.type === "boolean")
    return Prisma.sql`jsonb_typeof(${value}) = 'boolean'`;
  if (shape.type === "string") {
    const text = Prisma.sql`${value} #>> '{}'`;
    const checks = [Prisma.sql`jsonb_typeof(${value}) = 'string'`];
    if (shape.pattern !== undefined)
      checks.push(Prisma.sql`${text} ~ ${shape.pattern}`);
    if (shape.minLength !== undefined)
      checks.push(Prisma.sql`char_length(${text}) >= ${shape.minLength}`);
    // UTF-8 byte length is conservative for the codec's UTF-16 maximum, including astral symbols.
    if (shape.maxLength !== undefined)
      checks.push(Prisma.sql`octet_length(${text}) <= ${shape.maxLength}`);
    if (shape.minLength !== undefined && shape.maxLength !== undefined) {
      // The only trimmed string in this codec is the tier name. A letter/digit proves trim
      // cannot empty it; other valid names remain candidates for the complete JS codec.
      checks.push(Prisma.sql`${text} ~ '[[:alnum:]]'`);
    }
    if (
      shape.format !== undefined &&
      (shape.format !== "uuid" || shape.pattern === undefined)
    )
      return Prisma.sql`false`;
    return Prisma.sql`(${Prisma.join(checks, " AND ")})`;
  }
  if (shape.type === "integer" || shape.type === "number") {
    const number = Prisma.sql`CASE WHEN jsonb_typeof(${value}) = 'number' THEN (${value} #>> '{}')::numeric ELSE NULL END`;
    const checks = [Prisma.sql`jsonb_typeof(${value}) = 'number'`];
    if (shape.type === "integer")
      checks.push(Prisma.sql`trunc(${number}) = ${number}`);
    if (shape.minimum !== undefined)
      checks.push(Prisma.sql`${number} >= ${shape.minimum}`);
    if (shape.maximum !== undefined)
      checks.push(Prisma.sql`${number} <= ${shape.maximum}`);
    if (typeof shape.exclusiveMinimum === "number")
      checks.push(Prisma.sql`${number} > ${shape.exclusiveMinimum}`);
    if (typeof shape.exclusiveMaximum === "number")
      checks.push(Prisma.sql`${number} < ${shape.exclusiveMaximum}`);
    return Prisma.sql`(${Prisma.join(checks, " AND ")})`;
  }
  if (
    shape.type === "array" &&
    shape.items !== undefined &&
    !Array.isArray(shape.items) &&
    typeof shape.items !== "boolean"
  ) {
    const array = arrayValue(value);
    const checks = [
      Prisma.sql`jsonb_typeof(${value}) = 'array'`,
      Prisma.sql`NOT EXISTS (
      SELECT 1 FROM (SELECT jsonb_array_elements(${array}) AS value) AS item WHERE NOT COALESCE(${matchesSnapshotShape(Prisma.sql`item.value`, shape.items)}, false))`,
    ];
    if (shape.minItems !== undefined)
      checks.push(
        Prisma.sql`jsonb_array_length(${array}) >= ${shape.minItems}`,
      );
    if (shape.maxItems !== undefined)
      checks.push(
        Prisma.sql`jsonb_array_length(${array}) <= ${shape.maxItems}`,
      );
    return Prisma.sql`(${Prisma.join(checks, " AND ")})`;
  }
  if (
    shape.type === "object" &&
    shape.properties !== undefined &&
    shape.additionalProperties === false
  ) {
    const object = Prisma.sql`CASE WHEN jsonb_typeof(${value}) = 'object' THEN ${value} ELSE '{}'::jsonb END`;
    const keys = Object.keys(shape.properties);
    const checks = [
      Prisma.sql`jsonb_typeof(${value}) = 'object'`,
      Prisma.sql`${object} - ${keys}::text[] = '{}'::jsonb`,
    ];
    for (const [key, property] of Object.entries(shape.properties)) {
      const match = matchesSnapshotShape(
        Prisma.sql`${object}->${key}`,
        property,
      );
      checks.push(
        shape.required?.includes(key) === true
          ? Prisma.sql`(${object} ? ${key} AND ${match})`
          : Prisma.sql`(NOT (${object} ? ${key}) OR ${match})`,
      );
    }
    return Prisma.sql`(${Prisma.join(checks, " AND ")})`;
  }
  // Unknown generated metadata cannot prove a valid snapshot.
  return Prisma.sql`false`;
}
