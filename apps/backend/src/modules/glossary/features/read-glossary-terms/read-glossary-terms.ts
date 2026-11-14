import { glossaryTermIdSchema } from "@inside/material-blocks";

import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { GlossaryTerm } from "../../domain/glossary-term.js";
import type {
  GlossaryAuthoringError,
  GlossaryDependencyError,
} from "../../facets/glossary/glossary.js";
import {
  authorizeGlossaryAuthor,
  type GlossaryOperationDependencies,
} from "../../shared/glossary-dependencies.js";
import { storedGlossaryTerm } from "../../shared/stored-glossary-term.js";

const unavailable = {
  ok: false,
  error: { code: "dependency_unavailable", retryable: true },
} as const;

export async function listGlossaryTerms(
  dependencies: GlossaryOperationDependencies,
  query: { readonly actor: string },
): Promise<Result<readonly GlossaryTerm[], GlossaryAuthoringError>> {
  const forbidden = await authorizeGlossaryAuthor(dependencies, query.actor);
  if (forbidden !== null) return { ok: false, error: forbidden };
  try {
    const rows = await dependencies.prisma.glossaryTerm.findMany({
      orderBy: { id: "asc" },
    });
    return { ok: true, value: rows.map(storedGlossaryTerm) };
  } catch (error) {
    return dependencyFailure(
      { module: "glossary", operation: "listGlossaryTerms" },
      error,
      unavailable,
    );
  }
}

/**
 * The source identifiers name published Materials the caller may show: one lesson for its deck or
 * the readable lessons of one course, so one statement serves them all.
 */
export async function introducedGlossaryTerms(
  dependencies: Pick<GlossaryOperationDependencies, "prisma">,
  sourceIds: readonly string[],
): Promise<Result<readonly GlossaryTerm[], GlossaryDependencyError>> {
  const requested = [...new Set(sourceIds)];
  if (requested.length === 0) return { ok: true, value: [] };
  try {
    const rows = await dependencies.prisma.glossaryTerm.findMany({
      where: { introducedInSourceId: { in: requested } },
      orderBy: { id: "asc" },
    });
    return { ok: true, value: rows.map(storedGlossaryTerm) };
  } catch (error) {
    return dependencyFailure(
      { module: "glossary", operation: "introducedGlossaryTerms" },
      error,
      unavailable,
    );
  }
}

/**
 * The identifiers come from one accepted Material body, which the body's own document limits
 * already bound, so one statement serves them all.
 */
export async function lookupGlossaryTerms(
  dependencies: Pick<GlossaryOperationDependencies, "prisma">,
  ids: readonly string[],
): Promise<Result<readonly GlossaryTerm[], GlossaryDependencyError>> {
  const requested = [
    ...new Set(ids.filter((id) => glossaryTermIdSchema.safeParse(id).success)),
  ];
  if (requested.length === 0) return { ok: true, value: [] };
  try {
    const rows = await dependencies.prisma.glossaryTerm.findMany({
      where: { id: { in: requested } },
    });
    const found = new Map(rows.map((row) => [row.id, storedGlossaryTerm(row)]));
    return {
      ok: true,
      value: requested.flatMap((id) => {
        const term = found.get(id);
        return term === undefined ? [] : [term];
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "glossary", operation: "lookupGlossaryTerms" },
      error,
      unavailable,
    );
  }
}
