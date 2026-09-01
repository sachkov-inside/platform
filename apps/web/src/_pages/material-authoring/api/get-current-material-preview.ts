import "server-only";

import { z } from "zod";

import type { MaterialPreviewPresentation } from "@/widgets/material-authoring/model";
import {
  BackendConnectionError,
  requestMaterialAuthoringReferences,
  requestMaterialPreview,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import { mapCurrentMaterialPreview } from "./material-preview-mapper";
import { getMaterialAuthoringReferences } from "@/features/material-authoring-references.server";

const materialIdSchema = z.uuid();
const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export type CurrentMaterialPreviewState =
  | { readonly kind: "ready"; readonly preview: MaterialPreviewPresentation }
  | { readonly kind: "not_found" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unexpected_error"; readonly reference: string };

export interface CurrentMaterialPreviewDependencies {
  readonly preview: typeof requestMaterialPreview;
  readonly references: typeof requestMaterialAuthoringReferences;
}

const productionDependencies: CurrentMaterialPreviewDependencies = {
  preview: requestMaterialPreview,
  references: requestMaterialAuthoringReferences,
};

export async function getCurrentMaterialPreview(
  materialId: string,
  accessToken: string,
  dependencies: CurrentMaterialPreviewDependencies = productionDependencies,
): Promise<CurrentMaterialPreviewState> {
  const parsedMaterialId = materialIdSchema.safeParse(materialId);
  if (!parsedMaterialId.success) {
    return { kind: "not_found" };
  }

  let result: BackendTransportResult;
  let references: Awaited<ReturnType<typeof getMaterialAuthoringReferences>>;
  try {
    [result, references] = await Promise.all([
      dependencies.preview(parsedMaterialId.data, accessToken),
      getMaterialAuthoringReferences(accessToken, dependencies.references),
    ]);
  } catch (error) {
    return {
      kind: "unexpected_error",
      reference:
        error instanceof BackendConnectionError ? error.code : "unexpected-preview-error",
    };
  }
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    const problem = problemSchema.safeParse(result.problem);
    if (
      result.response.status === 404 &&
      problem.success &&
      problem.data.code === "material_not_found"
    ) {
      return { kind: "not_found" };
    }
    return {
      kind: "unexpected_error",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "backend-response",
    };
  }

  if (references.kind !== "ready") {
    return references.kind === "unauthorized"
      ? { kind: "unauthorized" }
      : { kind: "unexpected_error", reference: references.reference };
  }

  const mapped = mapCurrentMaterialPreview(result.body, references.references);
  if (!mapped.ok || mapped.data.materialId !== parsedMaterialId.data) {
    return { kind: "unexpected_error", reference: "unexpected-preview-response" };
  }
  return { kind: "ready", preview: mapped.data.preview };
}
