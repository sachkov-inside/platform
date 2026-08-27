import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  PreviewMaterialOperation,
} from "./preview-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { loadCurrentMaterial } from "../../infrastructure/postgres/current-material.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import {
  accountId,
  materialIdSchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

const previewMaterialQuery = z
  .object({ actor: accountId, materialId: materialIdSchema })
  .strict();

export function assemblePreviewMaterial(
  dependencies: MaterialAuthoringDependencies,
): PreviewMaterialOperation {
  return async (input) => {
    const parsed = parseCommand(previewMaterialQuery, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    try {
      const current = await loadCurrentMaterial(
        dependencies.prisma,
        dependencies.materialBodyOperations,
        parsed.value.materialId,
      );
      if (current === undefined) {
        return failure({ code: "material_not_found" });
      }
      if (!current.ok) {
        return current;
      }
      const rendered = dependencies.materialBodyOperations.render(
        current.value.body,
      );
      if (!rendered.ok) {
        return rendered;
      }
      await dependencies.prisma.materialAccessAuditEvent.create({
        data: {
          id: randomUUID(),
          materialId: parsed.value.materialId,
          contentVersion: BigInt(current.value.lifecycle.contentVersion),
          actorId: parsed.value.actor,
          action: "preview",
          decision: "allow",
        },
      });
      return {
        ok: true,
        value: {
          materialId: parsed.value.materialId,
          contentVersion: current.value.lifecycle.contentVersion,
          publicationState: current.value.lifecycle.publicationState,
          metadata: current.value.metadata.toValues(),
          cacheScope: "private-no-store",
          body: rendered.value,
        },
      };
    } catch (error) {
      return { ok: false, error: mapPostgresReadError(error) };
    }
  };
}
