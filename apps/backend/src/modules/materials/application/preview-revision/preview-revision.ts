import { randomUUID } from "node:crypto";

import type { MaterialAuthoring } from "../material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "../material-authoring.dependencies.js";
import { failure } from "../shared/application-result.js";
import { toMaterialRevisionDto } from "../shared/material-revision-dto.js";
import { mapPostgresReadError } from "../shared/postgres-error-mapping.js";
import { validateRevisionQuery } from "../validate-revision/validate-revision.js";
import { parseCommand } from "../shared/command-validation.js";
import {
  loadCurrentRevisionId,
  loadMaterialRevision,
  loadMaterialRevisionHeader,
} from "../../infrastructure/postgres/material-persistence.js";

export function createPreviewRevision(
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring["previewRevision"] {
  return async (input) => {
    const parsed = parseCommand(validateRevisionQuery, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const query = parsed.value;
    try {
      const header = await loadMaterialRevisionHeader(
        dependencies.database,
        query.materialId,
        query.revisionId,
      );
      if (header === undefined) {
        const currentRevisionId = await loadCurrentRevisionId(
          dependencies.database,
          query.materialId,
        );
        return failure({
          code: currentRevisionId === undefined ? "material_not_found" : "revision_not_found",
        });
      }
      const decision = await dependencies.contentAccess.authorize({
        subject: { kind: "principal", principalId: query.actor },
        action: "preview",
        resource: {
          kind: "material_body",
          materialId: query.materialId,
          revisionId: query.revisionId,
          publication: "draft",
          access: header.access,
        },
      });
      if (!decision.allowed) {
        return failure(
          decision.reason === "temporarily_unavailable"
            ? { code: "dependency_unavailable", retryable: true }
            : { code: "forbidden" },
        );
      }
      const revision = await loadMaterialRevision(
        dependencies.database,
        dependencies.materialDocumentOperations,
        query.materialId,
        query.revisionId,
      );
      if (revision === undefined || !revision.ok) {
        return failure({ code: "internal_error", correlationId: randomUUID() });
      }
      const rendered = dependencies.materialDocumentOperations.render(revision.value.body);
      if (!rendered.ok) {
        return failure(rendered.error);
      }
      return {
        ok: true,
        value: {
          materialId: revision.value.materialId,
          revisionId: revision.value.id,
          metadata: toMaterialRevisionDto(revision.value).metadata,
          cacheScope: "private-no-store",
          body: rendered.value,
        },
      };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}
