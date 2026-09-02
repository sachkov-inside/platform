import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestMaterialDeletion,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import type { DeleteMaterialDraftResult } from "../model/delete-material-draft";

const formSchema = z
  .object({
    deleteVideoId: z.union([z.uuid(), z.literal("none")]).default("none"),
    expectedContentVersion: z.coerce.number().int().positive(),
    materialId: z.uuid(),
    submissionId: z.uuid(),
  })
  .strict();
const deletedSchema = z.object({ materialId: z.uuid() }).strict();
const problemSchema = z
  .object({
    code: z.string(),
    correlationId: z.string().optional(),
    currentContentVersion: z.number().int().positive().optional(),
    issues: z
      .array(z.object({ code: z.string(), path: z.string() }).strict())
      .optional(),
    status: z.number().int(),
  })
  .loose();

export async function executeDeleteMaterialDraft(
  formData: FormData,
  accessToken: string,
  request: typeof requestMaterialDeletion = requestMaterialDeletion,
): Promise<DeleteMaterialDraftResult> {
  const parsed = formSchema.safeParse({
    deleteVideoId: formData.get("deleteVideoId") ?? undefined,
    expectedContentVersion: formData.get("expectedContentVersion"),
    materialId: formData.get("materialId"),
    submissionId: formData.get("submissionId"),
  });
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: `/${issue.path.map(String).join("/")}`,
      })),
      kind: "invalid_input",
    };
  }

  let result: BackendTransportResult;
  try {
    result = await request(
      {
        deleteVideoId: parsed.data.deleteVideoId === "none" ? null : parsed.data.deleteVideoId,
        expectedContentVersion: parsed.data.expectedContentVersion,
        idempotencyKey: `web-delete-material-draft-${parsed.data.submissionId}`,
        materialId: parsed.data.materialId,
      },
      accessToken,
    );
  } catch (error) {
    if (error instanceof BackendConnectionError) {
      return error.code === "unavailable"
        ? { kind: "infrastructure_error", reference: error.code }
        : unexpected(error.code);
    }
    throw error;
  }
  if (!result.ok) return mapDeletionProblem(result);

  const receipt = deletedSchema.safeParse(result.body);
  return receipt.success && receipt.data.materialId === parsed.data.materialId
    ? { kind: "deleted", materialId: receipt.data.materialId }
    : unexpected("malformed-delete-response");
}

function mapDeletionProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
): DeleteMaterialDraftResult {
  if (result.response.status === 401) return { kind: "unauthorized" };
  if (result.response.status === 403) return { kind: "forbidden" };
  const problem = problemSchema.safeParse(result.problem);
  if (!problem.success) return unexpected("malformed-problem-response");
  if (
    result.response.status === 404 &&
    problem.data.code === "material_not_found"
  ) {
    return { kind: "not_found" };
  }
  if (
    result.response.status === 409 &&
    isDeletionConflictCode(problem.data.code)
  ) {
    return {
      ...(problem.data.currentContentVersion === undefined
        ? {}
        : { currentContentVersion: problem.data.currentContentVersion }),
      kind: "conflict",
      reason: problem.data.code,
    };
  }
  if (
    (result.response.status === 400 || result.response.status === 422) &&
    problem.data.issues !== undefined
  ) {
    return { issues: problem.data.issues, kind: "invalid_input" };
  }
  if (
    result.response.status === 503 &&
    problem.data.code === "dependency_unavailable"
  ) {
    return {
      kind: "infrastructure_error",
      reference: problem.data.correlationId ?? problem.data.code,
    };
  }
  if (
    result.response.status === 500 &&
    problem.data.code === "internal_error"
  ) {
    return {
      kind: "unexpected_error",
      reference: problem.data.correlationId ?? problem.data.code,
    };
  }
  return unexpected(`delete-material-draft-${problem.data.code}`);
}

function isDeletionConflictCode(
  code: string,
): code is Extract<DeleteMaterialDraftResult, { kind: "conflict" }>["reason"] {
  return (
    code === "draft_deletion_forbidden" ||
    code === "idempotency_key_reused" ||
    code === "stale_content_version"
  );
}

function unexpected(reference: string): DeleteMaterialDraftResult {
  return { kind: "unexpected_error", reference };
}
