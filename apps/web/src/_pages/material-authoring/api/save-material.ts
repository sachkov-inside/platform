import "server-only";
import { CONTENT_SOURCE_MISMATCH_MESSAGE } from "@/shared/lib/content-source-message";

import { MATERIAL_OUTCOMES } from "@/shared/api/material-lesson-facts";
import { productRemovalsFromProblem } from "@/shared/lib/product-removal";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { MaterialValidationIssue } from "@/widgets/material-authoring/model";
import {
  BackendConnectionError,
  requestMaterialSave,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type {
  saveMaterialInputSchema,
  SaveMaterialResult,
} from "../model/save-material";
import { parseMaterialDocumentFields } from "./parse-material-document-fields";

type ParsedSaveMaterialInput = z.output<typeof saveMaterialInputSchema>;
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

/** Maps a body that does not match the Save schema to the editor's validation messages. */
export function saveMaterialInvalidInput(
  error: z.ZodError,
): SaveMaterialResult {
  return {
    issues: error.issues.map((issue) => ({
      message: formIssueMessage(String(issue.path[0] ?? "form")),
      path: `/${issue.path.map(String).join("/")}`,
    })),
    kind: "invalid_input",
  };
}

export async function executeSaveMaterial(
  input: ParsedSaveMaterialInput,
  accessToken: string,
  dependencies: SaveMaterialDependencies = productionDependencies,
): Promise<SaveMaterialResult> {
  const parsed = backendSaveInput(input);
  if (!parsed.ok) {
    return { issues: parsed.issues, kind: "invalid_input" };
  }

  let saved: BackendTransportResult;
  try {
    saved = await dependencies.save(parsed.value, accessToken);
  } catch (error) {
    if (
      error instanceof BackendConnectionError &&
      error.code === "unavailable"
    ) {
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

function backendSaveInput(input: ParsedSaveMaterialInput):
  | {
      readonly ok: true;
      readonly value: Parameters<typeof requestMaterialSave>[0];
    }
  | {
      readonly issues: readonly MaterialValidationIssue[];
      readonly ok: false;
    } {
  const documentFields = parseMaterialDocumentFields(input);
  if (!documentFields.ok) return documentFields;

  return {
    ok: true,
    value: {
      access: input.access,
      ...(input.confirmedProductRemovals.length === 0
        ? {}
        : { confirmedProductRemovals: input.confirmedProductRemovals }),
      deleteVideoId: input.deleteVideoId,
      detachVideoIds: input.detachVideoIds,
      difficulty: input.difficulty === "unassigned" ? null : input.difficulty,
      outcomes: input.outcomes.filter(Boolean),
      document: documentFields.document,
      expectedContentVersion: input.expectedContentVersion,
      formatId: input.formatId === "unassigned" ? null : input.formatId,
      idempotencyKey: `web-save-${input.submissionId}`,
      materialId: input.materialId,
      publicationState: input.publicationState,
      ...(input.notifyTelegram === undefined
        ? {}
        : { notifyTelegram: input.notifyTelegram }),
      primaryVideoId: input.primaryVideoId,
      seriesIds: documentFields.seriesIds,
      summary: emptyToNull(input.summary),
      tagIds: input.tagIds,
      title: emptyToNull(input.title),
      topicId: input.topicId === "unassigned" ? null : input.topicId,
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
  if (
    result.response.status === 404 &&
    problem.data.code === "material_not_found"
  ) {
    return { kind: "not_found" };
  }
  const removals =
    result.response.status === 409
      ? productRemovalsFromProblem(result.problem)
      : null;
  if (removals !== null) {
    return { products: removals, kind: "removal_confirmation_required" };
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
  if (
    result.response.status === 503 &&
    problem.data.code === "dependency_unavailable"
  ) {
    return {
      kind: "infrastructure_error",
      reference: problem.data.correlationId ?? problem.data.code,
    };
  }
  throw new TypeError(`Unexpected Material Save problem: ${problem.data.code}`);
}

function mapBackendIssue(issue: {
  readonly code: string;
  readonly path: string;
}) {
  if (issue.code === "material_source_mismatch") {
    return { message: CONTENT_SOURCE_MISMATCH_MESSAGE, path: issue.path };
  }
  if (issue.code === "outcomes_too_few") {
    return {
      message: `Оставьте «Чему научишься» пустым или напишите ${String(MATERIAL_OUTCOMES.minPublishedCount)}–${String(MATERIAL_OUTCOMES.maxCount)} пункта.`,
      path: issue.path,
    };
  }
  if (issue.code === "membership_outside_product") {
    return {
      message:
        "Закрытый материал публикуется только внутри продукта: добавьте его в руководство или откройте всем.",
      path: issue.path,
    };
  }
  const message = issue.path.endsWith("/title")
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
