import { z } from "zod";

import type {
  LoadMaterialError,
  LoadMaterialOperation,
} from "./load-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { loadCurrentMaterial, toMaterialDto } from "../../infrastructure/postgres/current-material.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import {
  accountId,
  materialIdSchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

const loadMaterialQuery = z
  .object({ actor: accountId, materialId: materialIdSchema })
  .strict();

export function assembleLoadMaterial(
  dependencies: MaterialAuthoringDependencies,
): LoadMaterialOperation {
  return async (input) => {
    const parsed = parseCommand(loadMaterialQuery, input);
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
      const material = await loadCurrentMaterial(
        dependencies.prisma,
        dependencies.materialBodyOperations,
        parsed.value.materialId,
      );
      if (material === undefined) {
        return failure<never, LoadMaterialError>({ code: "material_not_found" });
      }
      if (!material.ok) return material;
      const [primaryVideo, latestVideoDeletion] = await Promise.all([
        material.value.primaryVideoId === null || dependencies.videos === undefined
          ? Promise.resolve({ ok: true as const, value: null })
          : dependencies.videos.loadAuthoringPresentation({
              materialId: parsed.value.materialId,
              videoId: material.value.primaryVideoId,
            }),
        dependencies.videos === undefined
          ? Promise.resolve({ ok: true as const, value: null })
          : dependencies.videos.loadLatestDeletion(parsed.value.materialId),
      ]);
      if (!primaryVideo.ok || !latestVideoDeletion.ok) {
        return failure<never, LoadMaterialError>({
          code: "dependency_unavailable",
          retryable: true,
        });
      }
      return {
        ok: true,
        value: toMaterialDto(material.value, {
          primaryVideo: primaryVideo.value,
          latestVideoDeletion: latestVideoDeletion.value,
        }),
      };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}
