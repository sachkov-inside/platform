import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { PlatformDatabase } from "../../../../infrastructure/postgres/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import {
  materialId,
  materialRevisionId,
} from "../../domain/material-identifiers.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { recordMaterialAccessDecision } from "../../infrastructure/postgres/access-audit-persistence.js";
import { loadCurrentPublishedMaterialRevision } from "../../infrastructure/postgres/material-persistence.js";
import { selectPublishedMaterialProjectionBySlug } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import type { ContentAccess } from "../ports/content-access.js";
import { mapPostgresReadError } from "../shared/postgres-error-mapping.js";
import type {
  PublishedMaterialReadResult,
  ReadPublishedMaterialQuery,
} from "./published-material-reader.js";

const querySchema = z
  .object({
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("anonymous") }).strict(),
      z
        .object({
          kind: z.literal("principal"),
          principalId: normalizedUuidSchema,
        })
        .strict(),
    ]),
    slug: z
      .string()
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();

export async function readPublishedMaterial(
  dependencies: {
    readonly database: PlatformDatabase;
    readonly contentAccess: ContentAccess;
    readonly materialBodyOperations: MaterialBodyOperations;
  },
  query: ReadPublishedMaterialQuery,
): Promise<PublishedMaterialReadResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  const { subject, slug } = parsed.data;
  try {
    const projection = await selectPublishedMaterialProjectionBySlug(
      dependencies.database,
      slug,
    );
    if (projection === undefined) {
      return { ok: false, error: { code: "material_not_found" } };
    }

    let access;
    try {
      access = await dependencies.contentAccess.authorize({
        subject,
        action: "read",
        resource: {
          kind: "material_body",
          materialId: projection.materialId,
          revisionId: projection.revisionId,
          publication: "published",
          access: projection.access,
        },
      });
    } catch {
      access = {
        allowed: false as const,
        reason: "temporarily_unavailable" as const,
      };
    }

    if (projection.access === "membership") {
      await recordMaterialAccessDecision(dependencies.database, {
        subject,
        action: "read",
        materialId: materialId(projection.materialId),
        revisionId: materialRevisionId(projection.revisionId),
        decision: access,
      });
    }
    if (!access.allowed) {
      return {
        ok: true,
        value: {
          kind: "teaser",
          cacheScope:
            subject.kind === "anonymous" ? "public" : "private-no-store",
          projection,
          access,
        },
      };
    }

    const revision = await loadCurrentPublishedMaterialRevision(
      dependencies.database,
      dependencies.materialBodyOperations,
      materialId(projection.materialId),
      materialRevisionId(projection.revisionId),
    );
    if (revision === undefined || !revision.ok) {
      return internalError();
    }
    const rendered = dependencies.materialBodyOperations.render(revision.value.body);
    if (!rendered.ok) {
      return internalError();
    }
    return {
      ok: true,
      value: {
        kind: "available",
        cacheScope: access.reason === "public" ? "public" : "private-no-store",
        projection,
        body: rendered.value,
      },
    };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}

function internalError(): PublishedMaterialReadResult {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
