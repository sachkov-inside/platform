import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { materialId } from "../../domain/material-identifiers.js";
import {
  practiceDefinitionDigest,
  practiceIdSchema,
} from "../../domain/practice-definition.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import {
  listPracticeSnapshots,
  loadPracticeSnapshots,
  loadPracticeSnapshot,
  type PracticeSnapshot,
} from "./practice-snapshot.js";
import type {
  ReadPublishedPracticeOperation,
  ListPublishedPracticesOperation,
  ReadPublishedPracticeQuery,
  PublishedPracticeError,
  PublishedPractice,
} from "./read-published-practice.contract.js";

const querySchema = z
  .object({
    subject: z
      .object({ kind: z.literal("account"), accountId: z.uuid() })
      .strict(),
    practiceId: practiceIdSchema,
    expectedPracticeVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    expectedContentVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();

export function assembleReadPublishedPractice(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly contentAccess: ContentAccess;
}): ReadPublishedPracticeOperation {
  return async (query: ReadPublishedPracticeQuery) => {
    if (query.subject.kind === "anonymous") return unavailable();
    if (!querySchema.safeParse(query).success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    try {
      const first = await loadPracticeSnapshot(
        dependencies.prisma,
        query.practiceId,
      );
      if (
        first?.publication_state !== "published" ||
        first.material_state !== "published"
      )
        return unavailable();
      const access = await dependencies.contentAccess.authorize({
        subject: query.subject,
        action: "read",
        resource: {
          kind: "material",
          materialId: materialId(first.material_id),
        },
        enforcementPoint: "published_material_read",
        correlationId: randomUUID(),
      });
      if (access.effect !== "allow") return unavailable();
      const current = await loadPracticeSnapshot(
        dependencies.prisma,
        query.practiceId,
      );
      return validatedPractice(
        first,
        current,
        access.checkedContentVersion,
        query,
      );
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "readPublishedPractice" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

export function assembleListPublishedPractices(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly contentAccess: ContentAccess;
}): ListPublishedPracticesOperation {
  return async (query) => {
    if (query.subject.kind === "anonymous") return unavailable();
    if (
      !querySchema.shape.subject.safeParse(query.subject).success ||
      !z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
        .max(120)
        .safeParse(query.materialSlug).success
    )
      return { ok: false, error: { code: "invalid_request_shape" } };
    try {
      const first = await listPracticeSnapshots(
        dependencies.prisma,
        query.materialSlug,
      );
      const owningMaterial = first[0];
      if (owningMaterial === undefined) return { ok: true, value: [] };
      const access = await dependencies.contentAccess.authorize({
        subject: query.subject,
        action: "read",
        resource: {
          kind: "material",
          materialId: materialId(owningMaterial.material_id),
        },
        enforcementPoint: "published_material_read",
        correlationId: randomUUID(),
      });
      if (access.effect !== "allow") return unavailable();
      const current = new Map(
        (
          await loadPracticeSnapshots(
            dependencies.prisma,
            first.map(({ practice_id }) => practice_id),
          )
        ).map((snapshot) => [snapshot.practice_id, snapshot]),
      );
      const values: PublishedPractice[] = [];
      for (const snapshot of first) {
        if (snapshot.material_id !== owningMaterial.material_id)
          return { ok: false, error: { code: "practice_context_changed" } };
        const result = validatedPractice(
          snapshot,
          current.get(snapshot.practice_id),
          access.checkedContentVersion,
          {},
        );
        if (!result.ok) return result;
        if (result.value.materialSlug !== query.materialSlug)
          return { ok: false, error: { code: "practice_context_changed" } };
        values.push(result.value);
      }
      return { ok: true, value: values };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "listPublishedPractices" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

function unavailable(): {
  readonly ok: false;
  readonly error: PublishedPracticeError;
} {
  return { ok: false, error: { code: "practice_not_available" } };
}

/** Single and list reads enforce the same post-authorization binding and version validation. */
function validatedPractice(
  first: PracticeSnapshot,
  current: PracticeSnapshot | undefined,
  checkedContentVersion: number | undefined,
  query: {
    readonly expectedPracticeVersion?: number;
    readonly expectedContentVersion?: number;
  },
):
  | { readonly ok: true; readonly value: PublishedPractice }
  | { readonly ok: false; readonly error: PublishedPracticeError } {
  if (
    current?.publication_state !== "published" ||
    current.material_state !== "published" ||
    current.practice_version !== first.practice_version ||
    current.material_id !== first.material_id ||
    current.material_version !== checkedContentVersion ||
    current.material_slug === null ||
    (query.expectedPracticeVersion !== undefined &&
      current.practice_version !== query.expectedPracticeVersion) ||
    (query.expectedContentVersion !== undefined &&
      current.material_version !== query.expectedContentVersion)
  )
    return { ok: false, error: { code: "practice_context_changed" } };
  if (
    current.bound_content_version !== current.material_version ||
    current.bound_source_id !== current.material_source_id ||
    current.bound_source_revision !== current.material_source_revision
  )
    return {
      ok: false,
      error: {
        code: "practice_context_unavailable",
        reason: "source_changed",
      },
    };
  const sourceReference = {
    materialSourceId: current.bound_source_id,
    materialSourceRevision: current.bound_source_revision,
  };
  if (
    practiceDefinitionDigest(current.definition, sourceReference) !==
    current.definition_digest
  )
    throw new Error("Stored practice definition digest mismatch");
  return {
    ok: true,
    value: {
      practiceId: current.practice_id,
      practiceVersion: current.practice_version,
      definitionDigest: current.definition_digest,
      definition: current.definition,
      materialId: current.material_id,
      materialSlug: current.material_slug,
      materialContentVersion: current.material_version,
      sourceReference,
      provenance: {
        repository: current.source_repository,
        commit: current.source_commit,
        path: current.source_path,
      },
    },
  };
}
