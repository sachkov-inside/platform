import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  BackendConnectionError,
  requestCurrentMaterial,
  requestMaterialDeletion,
  requestMaterialSave,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import { materialDocumentSchema } from "../model/material-document-schema";
import type {
  MaterialLifecycleActionState,
  MaterialLifecycleOperation,
} from "../model/material-lifecycle-state";

const formSchema = z
  .object({
    expectedContentVersion: z.coerce.number().int().positive(),
    materialId: z.uuid(),
    operation: z.enum(["delete", "publish", "unpublish"]),
    submissionId: z.uuid(),
  })
  .strict();
const seriesMembershipSchema = z
  .object({ ordinal: z.number().int().positive(), seriesId: z.uuid() })
  .strict();
const currentMaterialSchema = z
  .object({
    body: z
      .object({ doc: materialDocumentSchema, schemaVersion: z.literal(1) })
      .strict(),
    contentVersion: z.number().int().positive(),
    firstPublishedAt: z.iso.datetime({ offset: true }).nullable(),
    materialId: z.uuid(),
    metadata: z
      .object({
        access: z.enum(["free", "membership"]),
        formatId: z.uuid().nullable(),
        seriesMemberships: z.array(seriesMembershipSchema),
        slug: z.string().nullable(),
        summary: z.string().nullable(),
        tagIds: z.array(z.uuid()),
        title: z.string().nullable(),
        topicId: z.uuid().nullable(),
      })
      .strict(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
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

export interface MaterialLifecycleDependencies {
  readonly delete: typeof requestMaterialDeletion;
  readonly load: typeof requestCurrentMaterial;
  readonly save: typeof requestMaterialSave;
}

const productionDependencies: MaterialLifecycleDependencies = {
  delete: requestMaterialDeletion,
  load: requestCurrentMaterial,
  save: requestMaterialSave,
};

export async function executeMaterialLifecycleMutation(
  formData: FormData,
  accessToken: string,
  dependencies: MaterialLifecycleDependencies = productionDependencies,
): Promise<MaterialLifecycleActionState> {
  const parsed = formSchema.safeParse({
    expectedContentVersion: formData.get("expectedContentVersion"),
    materialId: formData.get("materialId"),
    operation: formData.get("operation"),
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

  const command = parsed.data;
  const idempotencyKey = `web-lifecycle-${command.submissionId}`;
  if (command.operation === "delete") {
    const deleted = await request(
      () =>
        dependencies.delete(
          {
            expectedContentVersion: command.expectedContentVersion,
            idempotencyKey,
            materialId: command.materialId,
          },
          accessToken,
        ),
      command.operation,
    );
    if (!deleted.ok) return deleted.state;
    const receipt = deletedSchema.safeParse(deleted.result.body);
    return receipt.success && receipt.data.materialId === command.materialId
      ? { kind: "deleted", materialId: receipt.data.materialId }
      : unexpected("malformed-delete-response");
  }

  const loaded = await request(
    () => dependencies.load(command.materialId, accessToken),
    command.operation,
  );
  if (!loaded.ok) return loaded.state;
  const current = currentMaterialSchema.safeParse(loaded.result.body);
  if (!current.success || current.data.materialId !== command.materialId) {
    return unexpected("malformed-current-material-response");
  }

  const targetState = command.operation === "publish" ? "published" : "unpublished";
  const saved = await request(
    () =>
      dependencies.save(
        {
          access: current.data.metadata.access,
          document: current.data.body.doc,
          expectedContentVersion: command.expectedContentVersion,
          formatId: current.data.metadata.formatId,
          idempotencyKey,
          materialId: command.materialId,
          publicationState: targetState,
          seriesIds: current.data.metadata.seriesMemberships.map(
            ({ seriesId }) => seriesId,
          ),
          summary: current.data.metadata.summary,
          tagIds: current.data.metadata.tagIds,
          title: current.data.metadata.title,
          topicId: current.data.metadata.topicId,
        },
        accessToken,
      ),
    command.operation,
  );
  if (!saved.ok) return saved.state;
  const receipt = receiptSchema.safeParse(saved.result.body);
  if (
    !receipt.success ||
    receipt.data.materialId !== command.materialId ||
    receipt.data.publicationState !== targetState
  ) {
    return unexpected("malformed-save-response");
  }
  return {
    contentVersion: receipt.data.contentVersion,
    kind: "saved",
    nextSubmissionId: randomUUID(),
    publicationState: targetState,
  };
}

async function request(
  invoke: () => Promise<BackendTransportResult>,
  operation: MaterialLifecycleOperation,
): Promise<
  | { readonly ok: true; readonly result: Extract<BackendTransportResult, { ok: true }> }
  | { readonly ok: false; readonly state: MaterialLifecycleActionState }
> {
  let result: BackendTransportResult;
  try {
    result = await invoke();
  } catch (error) {
    if (error instanceof BackendConnectionError) {
      return {
        ok: false,
        state:
          error.code === "unavailable"
            ? { kind: "infrastructure_error", reference: error.code }
            : unexpected(error.code),
      };
    }
    throw error;
  }
  return result.ok
    ? { ok: true, result }
    : { ok: false, state: mapProblem(result, operation) };
}

function mapProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
  operation: MaterialLifecycleOperation,
): MaterialLifecycleActionState {
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
    isConflictCode(problem.data.code)
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
  return unexpected(`${operation}-${problem.data.code}`);
}

function isConflictCode(
  code: string,
): code is Extract<MaterialLifecycleActionState, { kind: "conflict" }>["reason"] {
  return (
    code === "draft_deletion_forbidden" ||
    code === "idempotency_key_reused" ||
    code === "invalid_publication_transition" ||
    code === "stale_content_version"
  );
}

function unexpected(reference: string): MaterialLifecycleActionState {
  return { kind: "unexpected_error", reference };
}
