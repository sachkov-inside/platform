import { z } from "zod";

import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import {
  GLOSSARY_TERMS_MAX,
  glossaryTermSchema,
  type GlossaryTerm,
} from "../../domain/glossary-term.js";
import type {
  GlossaryAuthoringError,
  GlossaryUpsert,
} from "../../facets/glossary/glossary.js";
import type { GlossaryOperationDependencies } from "../../shared/glossary-dependencies.js";
import { authorizeGlossaryAuthor } from "../../shared/glossary-dependencies.js";
import { storedGlossaryTerm } from "../../shared/stored-glossary-term.js";

export const upsertGlossaryTermsBodySchema = z
  .object({ terms: z.array(glossaryTermSchema).max(GLOSSARY_TERMS_MAX) })
  .strict();

const sameTerm = (left: GlossaryTerm, right: GlossaryTerm): boolean =>
  left.title === right.title &&
  left.englishTitle === right.englishTitle &&
  left.shortDefinition === right.shortDefinition &&
  left.fullDefinition === right.fullDefinition &&
  left.introducedInSourceId === right.introducedInSourceId;

/**
 * Creates or updates each listed term by its identifier. A package carries only the terms its
 * Materials need, so a term missing from the list stays as it is (content-studio#88).
 */
export async function upsertGlossaryTerms(
  dependencies: GlossaryOperationDependencies,
  command: { readonly actor: string; readonly terms: unknown },
): Promise<Result<GlossaryUpsert, GlossaryAuthoringError>> {
  const forbidden = await authorizeGlossaryAuthor(dependencies, command.actor);
  if (forbidden !== null) return { ok: false, error: forbidden };
  const parsed = upsertGlossaryTermsBodySchema.shape.terms.safeParse(
    command.terms,
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_glossary",
        message: "Glossary terms are invalid",
      },
    };
  }
  const terms = parsed.data;
  const ids = terms.map((term) => term.id);
  if (new Set(ids).size !== terms.length) {
    return {
      ok: false,
      error: {
        code: "invalid_glossary",
        message: "A term identifier appears twice",
      },
    };
  }
  try {
    const upsert = await dependencies.prisma.$transaction(async (tx) => {
      // Two writes must not interleave their reads and writes; readers are not blocked.
      await tx.$executeRaw(
        Prisma.sql`lock table glossary.terms in exclusive mode`,
      );
      const stored = new Map(
        (await tx.glossaryTerm.findMany({ where: { id: { in: ids } } })).map(
          (row) => [row.id, storedGlossaryTerm(row)],
        ),
      );
      const created = terms.filter((term) => !stored.has(term.id));
      const changed = terms.filter((term) => {
        const current = stored.get(term.id);
        return current !== undefined && !sameTerm(current, term);
      });
      if (created.length > 0) {
        await tx.glossaryTerm.createMany({ data: created });
      }
      const now = new Date();
      for (const term of changed) {
        const { id, ...fields } = term;
        await tx.glossaryTerm.update({
          where: { id },
          data: { ...fields, updatedAt: now },
        });
      }
      return {
        created: created.length,
        updated: changed.length,
        unchanged: terms.length - created.length - changed.length,
      };
    });
    return { ok: true, value: upsert };
  } catch (error) {
    return dependencyFailure(
      { module: "glossary", operation: "upsertGlossaryTerms" },
      error,
      {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      },
    );
  }
}
