import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  GLOSSARY_MARKS_QUERY_MAX,
  glossaryTermMarkValueSchema,
  type GlossaryTermMark,
} from "../../domain/glossary-term-mark.js";
import type { GlossaryMarkError } from "../../facets/glossary/glossary.js";
import type { GlossaryOperationDependencies } from "../../shared/glossary-dependencies.js";

const readQuerySchema = z
  .object({
    accountId: z.uuid(),
    termIds: z.array(glossaryTermIdSchema).min(1).max(GLOSSARY_MARKS_QUERY_MAX),
  })
  .strict();

const setCommandSchema = z
  .object({
    accountId: z.uuid(),
    termId: glossaryTermIdSchema,
    mark: glossaryTermMarkValueSchema,
  })
  .strict();

const unavailable = {
  ok: false,
  error: { code: "dependency_unavailable", retryable: true },
} as const;

function storedMark(row: {
  readonly termId: string;
  readonly mark: string;
  readonly markedAt: Date;
}): GlossaryTermMark {
  return {
    termId: row.termId,
    mark: glossaryTermMarkValueSchema.parse(row.mark),
    markedAt: row.markedAt.toISOString(),
  };
}

/** A mark says nothing about the term's text, so reading or setting one needs no content access. */
export async function readGlossaryTermMarks(
  dependencies: Pick<GlossaryOperationDependencies, "prisma">,
  query: { readonly accountId: string; readonly termIds: readonly string[] },
): Promise<Result<readonly GlossaryTermMark[], GlossaryMarkError>> {
  const parsed = readQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const termIds = [...new Set(parsed.data.termIds)];
  try {
    const rows = await dependencies.prisma.glossaryTermMark.findMany({
      where: {
        accountId: parsed.data.accountId.toLowerCase(),
        termId: { in: termIds },
      },
    });
    const marks = new Map(rows.map((row) => [row.termId, storedMark(row)]));
    return {
      ok: true,
      value: termIds.flatMap((id) => {
        const mark = marks.get(id);
        return mark === undefined ? [] : [mark];
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "glossary", operation: "readGlossaryTermMarks" },
      error,
      unavailable,
    );
  }
}

export async function setGlossaryTermMark(
  dependencies: Pick<GlossaryOperationDependencies, "prisma">,
  command: {
    readonly accountId: string;
    readonly termId: string;
    readonly mark: string;
  },
): Promise<Result<GlossaryTermMark, GlossaryMarkError>> {
  const parsed = setCommandSchema.safeParse(command);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const accountId = parsed.data.accountId.toLowerCase();
  try {
    const term = await dependencies.prisma.glossaryTerm.findUnique({
      where: { id: parsed.data.termId },
      select: { id: true },
    });
    if (term === null) return { ok: false, error: { code: "term_not_found" } };
    const markedAt = new Date();
    const row = await dependencies.prisma.glossaryTermMark.upsert({
      where: {
        accountId_termId: { accountId, termId: parsed.data.termId },
      },
      create: {
        accountId,
        termId: parsed.data.termId,
        mark: parsed.data.mark,
        markedAt,
      },
      update: { mark: parsed.data.mark, markedAt },
    });
    return { ok: true, value: storedMark(row) };
  } catch (error) {
    // The term may leave the Glossary between the check and the write.
    if (isForeignKeyViolation(error))
      return { ok: false, error: { code: "term_not_found" } };
    return dependencyFailure(
      { module: "glossary", operation: "setGlossaryTermMark" },
      error,
      unavailable,
    );
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}
