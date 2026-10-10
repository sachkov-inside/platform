import { z } from "zod";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import {
  authoringTermSchema,
  type ListAuthoringTermsOperation,
  type LoadAuthoringTermOperation,
} from "./read-authoring-terms.contract.js";

type Dependencies = Pick<
  MaterialAuthoringDependencies,
  "prisma" | "authorPolicy"
>;
function snapshot(row: {
  readonly definition: unknown;
  readonly termId: string;
  readonly termVersion: bigint;
  readonly definitionDigest: string;
  readonly publicationState: string;
  readonly sourceId: string | null;
  readonly sourceRevision: string | null;
}) {
  return authoringTermSchema.parse({
    definition: row.definition,
    termId: row.termId,
    termVersion: Number(row.termVersion),
    definitionDigest: row.definitionDigest,
    publicationState: row.publicationState,
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
  });
}

export function assembleListAuthoringTerms(
  dependencies: Dependencies,
): ListAuthoringTermsOperation {
  return async (input) => {
    const parsed = z
      .object({ actor: z.uuid(), cursor: z.uuid().optional() })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      parsed.data.actor,
    );
    if (!authorized.ok) return authorized;
    try {
      const rows = await dependencies.prisma.termDefinition.findMany({
        orderBy: { termId: "asc" },
        take: 101,
        ...(parsed.data.cursor === undefined
          ? {}
          : { where: { termId: { gt: parsed.data.cursor.toLowerCase() } } }),
      });
      const terms = rows.slice(0, 100).map(snapshot);
      return {
        ok: true,
        value: {
          terms,
          nextCursor: rows.length > 100 ? (terms.at(-1)?.termId ?? null) : null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "listAuthoringTerms" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

export function assembleLoadAuthoringTerm(
  dependencies: Dependencies,
): LoadAuthoringTermOperation {
  return async (input) => {
    const parsed = z
      .object({ actor: z.uuid(), termId: z.uuid() })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      parsed.data.actor,
    );
    if (!authorized.ok) return authorized;
    try {
      const row = await dependencies.prisma.termDefinition.findUnique({
        where: { termId: parsed.data.termId.toLowerCase() },
      });
      return row === null
        ? { ok: false, error: { code: "term_not_found" } }
        : { ok: true, value: snapshot(row) };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "loadAuthoringTerm" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}
