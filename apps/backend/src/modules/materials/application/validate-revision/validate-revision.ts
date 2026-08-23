import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ContentAuthoring } from "../content-authoring.interface.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { canAuthor } from "../ports/author-policy.js";
import { failure } from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import { entityId, parseCommand, principalId } from "../shared/command-validation.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import {
  loadCurrentRevisionId,
  loadMaterialRevision,
} from "../../infrastructure/postgres/material-persistence.js";

export const validateRevisionQuery = z
  .object({ actor: principalId, materialId: entityId, revisionId: entityId })
  .strict();

export function createValidateRevision(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["validateRevision"] {
  return async (input) => {
    const parsed = parseCommand(validateRevisionQuery, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const query = parsed.value;
    if (!(await canAuthor(dependencies.authorPolicy, query.actor))) {
      return failure({ code: "forbidden" });
    }
    try {
      const revision = await loadMaterialRevision(
        dependencies.database,
        dependencies.materialDocumentOperations,
        query.materialId,
        query.revisionId,
      );
      if (revision === undefined) {
        const currentRevisionId = await loadCurrentRevisionId(
          dependencies.database,
          query.materialId,
        );
        return failure({
          code: currentRevisionId === undefined ? "material_not_found" : "revision_not_found",
        });
      }
      if (!revision.ok) {
        return failure({ code: "internal_error", correlationId: randomUUID() });
      }
      const extraction = dependencies.materialDocumentOperations.extract(revision.value.body);
      if (!extraction.ok) {
        return failure(extraction.error);
      }
      return {
        ok: true,
        value: {
          materialId: revision.value.materialId,
          revisionId: revision.value.id,
          projectionDigest: fingerprintCommand({
            metadata: revision.value.metadata.toValues(),
            extraction: extraction.value,
          }),
          extraction: extraction.value,
        },
      };
    } catch (error) {
      return failure(mapPostgresError(error));
    }
  };
}
