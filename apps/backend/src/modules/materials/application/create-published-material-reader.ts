import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { MaterialBodyOperations } from "../domain/material-body/material-body.js";
import { loadPublicMaterialProjection } from "../infrastructure/postgres/lifecycle-persistence.js";
import { loadCurrentPublishedMaterialRevision } from "../infrastructure/postgres/material-persistence.js";
import { recordMaterialAccessDecision } from "../infrastructure/postgres/access-audit-persistence.js";
import {
  materialId,
  materialRevisionId,
} from "../domain/material-identifiers.js";
import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { ContentAccess } from "./ports/content-access.js";
import type { PublishedMaterialReader } from "./published-material-reader.interface.js";
import { normalizedUuidSchema } from "../domain/uuid.js";

const readPublishedMaterialQuerySchema = z
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

export function createPublishedMaterialReaderImplementation(dependencies: {
  readonly database: PlatformDatabase;
  readonly contentAccess: ContentAccess;
  readonly materialBodyOperations: MaterialBodyOperations;
}): PublishedMaterialReader {
  return {
    async read(query) {
      const parsed = readPublishedMaterialQuerySchema.safeParse(query);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      const { subject, slug } = parsed.data;
      try {
        const projection = await loadPublicMaterialProjection(dependencies.database, slug);
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
              cacheScope: subject.kind === "anonymous" ? "public" : "private-no-store",
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
          return {
            ok: false,
            error: { code: "internal_error", correlationId: randomUUID() },
          };
        }
        const rendered = dependencies.materialBodyOperations.render(revision.value.body);
        if (!rendered.ok) {
          return {
            ok: false,
            error: { code: "internal_error", correlationId: randomUUID() },
          };
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
      } catch {
        return {
          ok: false,
          error: { code: "dependency_unavailable", retryable: true },
        };
      }
    },
  };
}
