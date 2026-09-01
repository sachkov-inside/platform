import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  BackendConnectionError,
  requestMaterialPublicationTransition,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import type { TransitionMaterialPublicationResult } from "../model/transition-material-publication";

const formSchema = z
  .object({
    expectedContentVersion: z.coerce.number().int().positive(),
    materialId: z.uuid(),
    publicationState: z.enum(["published", "unpublished"]),
    submissionId: z.uuid(),
  })
  .strict();
const receiptSchema = z
  .object({
    contentVersion: z.number().int().positive(),
    materialId: z.uuid(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
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

export async function executeTransitionMaterialPublication(
  formData: FormData,
  accessToken: string,
  request: typeof requestMaterialPublicationTransition = requestMaterialPublicationTransition,
): Promise<TransitionMaterialPublicationResult> {
  const parsed = formSchema.safeParse({
    expectedContentVersion: formData.get("expectedContentVersion"),
    materialId: formData.get("materialId"),
    publicationState: formData.get("publicationState"),
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
        expectedContentVersion: parsed.data.expectedContentVersion,
        idempotencyKey: `web-transition-material-publication-${parsed.data.submissionId}`,
        materialId: parsed.data.materialId,
        publicationState: parsed.data.publicationState,
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
  if (!result.ok) return mapPublicationProblem(result);

  const receipt = receiptSchema.safeParse(result.body);
  if (
    !receipt.success ||
    receipt.data.materialId !== parsed.data.materialId ||
    receipt.data.publicationState !== parsed.data.publicationState
  ) {
    return unexpected("malformed-save-response");
  }
  return {
    contentVersion: receipt.data.contentVersion,
    kind: "saved",
    nextSubmissionId: randomUUID(),
    publicationState: parsed.data.publicationState,
  };
}

function mapPublicationProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
): TransitionMaterialPublicationResult {
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
    isPublicationConflictCode(problem.data.code)
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
  return unexpected(`transition-material-publication-${problem.data.code}`);
}

function isPublicationConflictCode(
  code: string,
): code is Extract<
  TransitionMaterialPublicationResult,
  { kind: "conflict" }
>["reason"] {
  return (
    code === "idempotency_key_reused" ||
    code === "invalid_publication_transition" ||
    code === "stale_content_version"
  );
}

function unexpected(reference: string): TransitionMaterialPublicationResult {
  return { kind: "unexpected_error", reference };
}
