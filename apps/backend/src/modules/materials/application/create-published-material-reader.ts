import { randomUUID } from "node:crypto";

import type { MaterialBodyOperations } from "../domain/material-body/material-body.js";
import { loadPublicMaterialProjection } from "../infrastructure/postgres/lifecycle-persistence.js";
import { loadCurrentPublishedMaterialRevision } from "../infrastructure/postgres/material-persistence.js";
import {
  materialId,
  materialRevisionId,
} from "../domain/material-identifiers.js";
import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { ContentAccess } from "./ports/content-access.js";
import type { PublishedMaterialReader } from "./published-material-reader.interface.js";

export function createPublishedMaterialReaderImplementation(dependencies: {
  readonly database: PlatformDatabase;
  readonly contentAccess: ContentAccess;
  readonly materialBodyOperations: MaterialBodyOperations;
}): PublishedMaterialReader {
  return {
    async read({ subject, slug }) {
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
