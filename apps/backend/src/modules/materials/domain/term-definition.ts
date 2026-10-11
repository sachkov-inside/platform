import {
  termDefinitionSchema,
  type TermDefinition,
} from "@inside/material-blocks";
import { z } from "zod";

export const termVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const publishedTermSchema = z
  .object({
    definition: termDefinitionSchema,
    termVersion: termVersionSchema,
    detailedMaterial: z
      .object({ materialId: z.uuid(), href: z.string() })
      .strict()
      .nullable(),
  })
  .strict();
export type PublishedTerm = z.infer<typeof publishedTermSchema>;

/** Both importer and editor writes compare the current mutation version. A source cannot claim a manual ID. */
export function termUpdateConflict(
  current: {
    readonly termVersion: number;
    readonly sourceId: string | null;
  } | null,
  expectedTermVersion: number | null,
  sourceId: string | null,
): "term_version_conflict" | "source_mismatch" | undefined {
  if ((current?.termVersion ?? null) !== expectedTermVersion)
    return "term_version_conflict";
  if (sourceId !== null && current !== null && current.sourceId !== sourceId)
    return "source_mismatch";
  return undefined;
}

/** Definitions are independently published. A detail link uses the existing Material read route and its ContentAccess guard. */
export function publishedTerm(
  definition: TermDefinition,
  termVersion: number,
  publicationState: string,
  material: {
    readonly materialId: string;
    readonly slug: string | null;
    readonly publicationState: string;
  } | null,
): PublishedTerm | null {
  if (publicationState !== "published") return null;
  const detailedMaterial =
    material?.publicationState === "published" && material.slug !== null
      ? { materialId: material.materialId, href: `/materials/${material.slug}` }
      : null;
  return publishedTermSchema.parse({
    definition: {
      id: definition.id,
      title: definition.title,
      aliases: definition.aliases,
      definition: definition.definition,
      ...(definition.example === undefined
        ? {}
        : { example: definition.example }),
      ...(detailedMaterial === null
        ? {}
        : { materialId: detailedMaterial.materialId }),
    },
    termVersion,
    detailedMaterial,
  });
}
