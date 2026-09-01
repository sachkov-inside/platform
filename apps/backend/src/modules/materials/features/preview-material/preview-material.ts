import { randomUUID } from "node:crypto";

import { z } from "zod";

import { accountId as checkedAccountId } from "../../../accounts/index.js";
import type {
  PreviewMaterialOperation,
} from "./preview-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { loadCurrentMaterial } from "../../infrastructure/postgres/current-material.js";
import { failure } from "../../shared/application-result.js";
import {
  accountId,
  materialIdSchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { hydrateMaterialAssets } from "../../domain/material-body/hydrate-material-assets.js";

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
    const correlationId = randomUUID();
    const access = await dependencies.contentAccess.authorize({
      subject: {
        kind: "account",
        accountId: checkedAccountId(parsed.value.actor),
      },
      resource: { kind: "material", materialId: parsed.value.materialId },
      action: "preview",
      enforcementPoint: "material_preview",
      correlationId,
    });
    if (access.effect === "deny") {
      switch (access.reason) {
        case "resource_not_found":
          return failure({ code: "material_not_found" });
        case "dependency_unavailable":
          return failure({ code: "dependency_unavailable", retryable: true });
        case "authentication_required":
        case "permission_required":
          return failure({ code: "forbidden" });
        case "entitlement_stale":
        case "membership_expired":
        case "membership_required":
        case "resource_action_invalid":
        case "resource_mismatch":
        case "resource_unpublished":
          return failure({ code: "internal_error", correlationId });
      }
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
      const resources = dependencies.materialBodyOperations.extract(current.value.body);
      if (!resources.ok) return resources;
      const loadedPresentations = dependencies.materialAssets === undefined
        ? { ok: true as const, value: [] }
        : await dependencies.materialAssets.loadPresentations(
            parsed.value.materialId,
            resources.value.resources.map((resource) => resource.assetId),
          );
      if (!loadedPresentations.ok) return loadedPresentations;
      return {
        ok: true,
        value: {
          materialId: parsed.value.materialId,
          contentVersion: current.value.lifecycle.contentVersion,
          publicationState: current.value.lifecycle.publicationState,
          metadata: current.value.metadata.toValues(),
          cacheScope: "private-no-store",
          body: hydrateMaterialAssets(rendered.value, loadedPresentations.value),
        },
      };
    } catch (error) {
      return { ok: false, error: mapPostgresReadError(error) };
    }
  };
}
