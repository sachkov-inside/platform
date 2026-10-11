import { termDefinitionSchema } from "@inside/material-blocks";
import { z } from "zod";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import {
  publishedTerm,
  type PublishedTerm,
} from "../../domain/term-definition.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export type ReadTermError =
  { readonly code: "invalid_request_shape" | "term_not_found" } | SystemError;

/** Reads current definitions on demand; cached Material bodies hold IDs, never definition snapshots. */
export class PublishedTermReader {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  async read(termId: string): Promise<Result<PublishedTerm, ReadTermError>> {
    const parsed = z.uuid().safeParse(termId);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    try {
      const row = await this.prisma.termDefinition.findUnique({
        where: { termId: parsed.data.toLowerCase() },
      });
      if (row?.publicationState !== "published")
        return { ok: false, error: { code: "term_not_found" } };
      const definition = termDefinitionSchema.parse(row.definition);
      const material =
        row.detailedMaterialId === null
          ? null
          : await this.prisma.material.findUnique({
              where: { id: row.detailedMaterialId },
              select: { id: true, slug: true, publicationState: true },
            });
      const card = publishedTerm(
        definition,
        Number(row.termVersion),
        row.publicationState,
        material === null
          ? null
          : {
              materialId: material.id,
              slug: material.slug,
              publicationState: material.publicationState,
            },
      );
      if (card === null)
        return { ok: false, error: { code: "term_not_found" } };
      return { ok: true, value: card };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "readPublishedTerm" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  }
}
