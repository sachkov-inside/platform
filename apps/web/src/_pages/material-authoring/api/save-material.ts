import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { MaterialValidationIssue } from "@/widgets/material-authoring/model";
import {
  BackendConnectionError,
  requestMaterialSave,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { SaveMaterialResult } from "../model/save-material";
import { parseMaterialDocumentFields } from "./parse-material-document-fields";
const formSchema = z.object({
  access: z.enum(["free", "membership"]),
  document: z.string().min(1).max(1_048_576),
  expectedContentVersion: z.coerce.number().int().positive(),
  formatId: z.union([z.uuid(), z.literal("unassigned")]),
  materialId: z.uuid(),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  seriesIds: z.string().max(100_000),
  submissionId: z.uuid(),
  summary: z.string().trim().max(500),
  tagIds: z.array(z.uuid()).max(100),
  title: z.string().trim().max(160),
  topicId: z.union([z.uuid(), z.literal("unassigned")]),
});
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

export interface SaveMaterialDependencies {
  readonly save: typeof requestMaterialSave;
}

const productionDependencies: SaveMaterialDependencies = {
  save: requestMaterialSave,
};

export async function executeSaveMaterial(
  formData: FormData,
  accessToken: string,
  dependencies: SaveMaterialDependencies = productionDependencies,
): Promise<SaveMaterialResult> {
  const parsed = parseForm(formData);
  if (!parsed.ok) {
    return { issues: parsed.issues, kind: "invalid_input" };
  }

  let saved: BackendTransportResult;
  try {
    saved = await dependencies.save(parsed.value, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "infrastructure_error", reference: error.code };
    }
    throw error;
  }
  if (!saved.ok) {
    return mapSaveProblem(saved, parsed.value.expectedContentVersion);
  }
  const receipt = receiptSchema.safeParse(saved.body);
  if (!receipt.success || receipt.data.materialId !== parsed.value.materialId) {
    throw new TypeError("Save receipt does not match the edited Material");
  }

  return {
    contentVersion: receipt.data.contentVersion,
    kind: "saved",
    nextSubmissionId: randomUUID(),
    publicationState: receipt.data.publicationState,
  };
}

function parseForm(
  formData: FormData,
):
  | {
      readonly ok: true;
      readonly value: Parameters<typeof requestMaterialSave>[0];
    }
  | { readonly issues: readonly MaterialValidationIssue[]; readonly ok: false } {
  const parsed = formSchema.safeParse({
    access: formData.get("access"),
    document: formData.get("document"),
    expectedContentVersion: formData.get("expectedContentVersion"),
    formatId: formData.get("formatId"),
    materialId: formData.get("materialId"),
    publicationState: formData.get("publicationState"),
    seriesIds: formData.get("seriesIds"),
    submissionId: formData.get("submissionId"),
    summary: formData.get("summary"),
    tagIds: formData.getAll("tagIds"),
    title: formData.get("title"),
    topicId: formData.get("topicId"),
  });
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        message: formIssueMessage(String(issue.path[0] ?? "form")),
        path: `/${issue.path.map(String).join("/")}`,
      })),
      ok: false,
    };
  }

  const documentFields = parseMaterialDocumentFields(parsed.data);
  if (!documentFields.ok) return documentFields;

  return {
    ok: true,
    value: {
      access: parsed.data.access,
      document: documentFields.document,
      expectedContentVersion: parsed.data.expectedContentVersion,
      formatId: parsed.data.formatId === "unassigned" ? null : parsed.data.formatId,
      idempotencyKey: `web-save-${parsed.data.submissionId}`,
      materialId: parsed.data.materialId,
      publicationState: parsed.data.publicationState,
      seriesIds: documentFields.seriesIds,
      summary: emptyToNull(parsed.data.summary),
      tagIds: parsed.data.tagIds,
      title: emptyToNull(parsed.data.title),
      topicId: parsed.data.topicId === "unassigned" ? null : parsed.data.topicId,
    },
  };
}

function mapSaveProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
  staleContentVersion: number,
): SaveMaterialResult {
  if (result.response.status === 401) return { kind: "unauthorized" };
  if (result.response.status === 403) return { kind: "forbidden" };
  const problem = problemSchema.safeParse(result.problem);
  if (!problem.success) {
    throw new TypeError("Malformed Material Save problem response");
  }
  if (result.response.status === 404 && problem.data.code === "material_not_found") {
    return { kind: "not_found" };
  }
  if (
    result.response.status === 409 &&
    problem.data.code === "stale_content_version" &&
    problem.data.currentContentVersion !== undefined
  ) {
    return {
      currentContentVersion: problem.data.currentContentVersion,
      kind: "conflict",
      staleContentVersion,
    };
  }
  if (
    (result.response.status === 400 || result.response.status === 422) &&
    problem.data.issues !== undefined
  ) {
    return {
      issues: problem.data.issues.map(mapBackendIssue),
      kind: "invalid_input",
    };
  }
  const conflictMessage = messageForConflict(problem.data.code);
  if (result.response.status === 409 && conflictMessage !== null) {
    return {
      issues: [{ message: conflictMessage, path: "/metadata" }],
      kind: "invalid_input",
    };
  }
  if (result.response.status === 503 && problem.data.code === "dependency_unavailable") {
    return {
      kind: "infrastructure_error",
      reference: problem.data.correlationId ?? problem.data.code,
    };
  }
  throw new TypeError(`Unexpected Material Save problem: ${problem.data.code}`);
}

function mapBackendIssue(issue: { readonly code: string; readonly path: string }) {
  const message =
    issue.path.endsWith("/title")
      ? "Укажите название перед публикацией."
      : issue.path.endsWith("/summary")
        ? "Укажите краткое описание перед публикацией."
        : issue.path.endsWith("/topicId")
          ? "Назначьте тему перед публикацией."
          : issue.path.endsWith("/formatId")
            ? "Назначьте формат перед публикацией."
            : `Проверьте поле ${issue.path}.`;
  return { message, path: issue.path };
}

function formIssueMessage(field: string): string {
  switch (field) {
    case "title":
      return "Название должно быть не длиннее 160 символов.";
    case "summary":
      return "Описание должно быть не длиннее 500 символов.";
    default:
      return "Проверьте данные Material и повторите сохранение.";
  }
}

function messageForConflict(code: string): string | null {
  switch (code) {
    case "series_ordinal_conflict":
      return "Эта позиция в Series уже занята.";
    case "invalid_publication_transition":
      return "Выбранный переход publication state недоступен.";
    case "idempotency_key_reused":
      return "Сохранение уже завершилось с другими данными. Обновите страницу.";
    default:
      return null;
  }
}

function emptyToNull(value: string): string | null {
  return value.length === 0 ? null : value;
}
