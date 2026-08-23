import { randomUUID } from "node:crypto";

import type { MaterialDocumentOperations } from "../domain/material-document/material-document.js";
import { loadPublicMaterialProjection } from "../infrastructure/postgres/lifecycle-persistence.js";
import { loadCurrentPublishedMaterialRevision } from "../infrastructure/postgres/material-persistence.js";
import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { ContentAccess } from "./ports/content-access.js";
import type { PublishedMaterials } from "./published-materials.interface.js";

export function createPublishedMaterialsImplementation(dependencies: {
  readonly database: PlatformDatabase;
  readonly contentAccess: ContentAccess;
  readonly materialDocumentOperations: MaterialDocumentOperations;
}): PublishedMaterials {
  return {
    async read({ subject, slug }) {
      try {
        const projection = await loadPublicMaterialProjection(dependencies.database, slug);
        if (projection === undefined) {
          return { ok: false, error: { code: "material_not_found" } };
        }
        let access;
        if (projection.access === "free") {
          access = { allowed: true as const, reason: "public" as const };
        } else {
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
          dependencies.materialDocumentOperations,
          projection.materialId,
          projection.revisionId,
        );
        if (revision === undefined || !revision.ok) {
          return {
            ok: false,
            error: { code: "internal_error", correlationId: randomUUID() },
          };
        }
        const rendered = dependencies.materialDocumentOperations.render(revision.value.body);
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
