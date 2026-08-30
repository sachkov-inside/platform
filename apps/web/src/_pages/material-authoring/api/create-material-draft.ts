import "server-only";

import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import type { MaterialValidationIssue } from "@/features/material-authoring";
import {
  BackendConnectionError,
  requestMaterialAuthoringReferences,
  requestMaterialDraftCreation,
  requestMaterialPreview,
  requestMaterialValidation,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type {
  CreateMaterialDraftActionState,
  CreatedMaterialDraft,
} from "../model/create-material-draft-state";
import { mapCurrentMaterialPreview } from "./material-preview-mapper";
import { getMaterialAuthoringReferences } from "./get-material-authoring-references";
import { materialDocumentSchema } from "./material-document-schema";

const formSchema = z.object({
  access: z.enum(["free", "membership"]),
  document: z.string().min(1).max(1_048_576),
  formatId: z.union([z.uuid(), z.literal("unassigned")]),
  submissionId: z.uuid(),
  seriesIds: z.string().max(100_000),
  summary: z.string().trim().min(1).max(500),
  tagIds: z.array(z.uuid()).max(100),
  title: z.string().trim().min(1).max(160),
  topicId: z.union([z.uuid(), z.literal("unassigned")]),
});

const receiptSchema = z
  .object({
    contentVersion: z.number().int().positive(),
    materialId: z.uuid(),
    publicationState: z.literal("draft"),
    publishedAt: z.null(),
  })
  .strict();

const validationSchema = z
  .object({
    contentVersion: z.number().int().positive(),
    extraction: z
      .object({
        headings: z.array(
          z.object({
            level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
            text: z.string(),
          }),
        ),
        plainText: z.string(),
        resources: z.array(z.unknown()),
      })
      .strict(),
    materialId: z.uuid(),
    projectionDigest: z.string().min(1),
  })
  .strict();

const problemSchema = z
  .object({
    code: z.string(),
    correlationId: z.string().optional(),
    issues: z
      .array(z.object({ code: z.string(), path: z.string() }).strict())
      .optional(),
    status: z.number().int(),
  })
  .loose();

interface ParsedDraftForm {
  readonly access: "free" | "membership";
  readonly document: JSONContent;
  readonly formatId: string | null;
  readonly idempotencyKey: string;
  readonly seriesIds: readonly string[];
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string | null;
}

export interface MaterialDraftWorkflowDependencies {
  readonly create: typeof requestMaterialDraftCreation;
  readonly preview: typeof requestMaterialPreview;
  readonly references: typeof requestMaterialAuthoringReferences;
  readonly validate: typeof requestMaterialValidation;
}

const productionDependencies: MaterialDraftWorkflowDependencies = {
  create: requestMaterialDraftCreation,
  preview: requestMaterialPreview,
  references: requestMaterialAuthoringReferences,
  validate: requestMaterialValidation,
};

export async function executeCreateMaterialDraft(
  formData: FormData,
  accessToken: string,
  dependencies: MaterialDraftWorkflowDependencies = productionDependencies,
): Promise<CreateMaterialDraftActionState> {
  const parsed = parseForm(formData);
  if (!parsed.ok) {
    return { issues: parsed.issues, kind: "invalid_input" };
  }

  let created: BackendTransportResult;
  try {
    created = await dependencies.create(parsed.value, accessToken);
  } catch (error) {
    return unexpected(error);
  }
  if (!created.ok) {
    return mapMutationProblem(created);
  }
  const receipt = receiptSchema.safeParse(created.body);
  if (!receipt.success) {
    return unexpected(receipt.error);
  }

  let validation: BackendTransportResult;
  let preview: BackendTransportResult;
  let references: Awaited<ReturnType<typeof getMaterialAuthoringReferences>>;
  try {
    [validation, preview, references] = await Promise.all([
      dependencies.validate(
        receipt.data.materialId,
        receipt.data.contentVersion,
        accessToken,
      ),
      dependencies.preview(receipt.data.materialId, accessToken),
      getMaterialAuthoringReferences(accessToken, dependencies.references),
    ]);
  } catch (error) {
    return unexpected(error);
  }

  const mappedValidation = mapValidation(validation);
  if (mappedValidation.kind === "unexpected_error") {
    return mappedValidation;
  }
  if (!preview.ok) {
    return mapMutationProblem(preview);
  }
  if (references.kind !== "ready") {
    return references.kind === "unauthorized"
      ? { kind: "unauthorized" }
      : { kind: "unexpected_error", reference: references.reference };
  }
  const mappedPreview = mapCurrentMaterialPreview(
    preview.body,
    references.references,
  );
  if (!mappedPreview.ok) {
    return unexpected(mappedPreview.error);
  }
  if (
    mappedPreview.data.materialId !== receipt.data.materialId ||
    mappedPreview.data.contentVersion !== receipt.data.contentVersion
  ) {
    return unexpected(new TypeError("Preview does not match the created Material"));
  }

  const current = mappedPreview.data;
  const draft: CreatedMaterialDraft = {
    access: current.access,
    contentVersion: current.contentVersion,
    document: parsed.value.document,
    formatId: current.formatId,
    materialId: current.materialId,
    preview: current.preview,
    slug: current.slug,
    seriesIds: parsed.value.seriesIds,
    summary: current.summary ?? parsed.value.summary,
    tagIds: current.tagIds,
    title: current.title ?? parsed.value.title,
    topicId: current.topicId,
    validation: mappedValidation.validation,
  };
  return { draft, kind: "created" };
}

function parseForm(
  formData: FormData,
):
  | { readonly ok: true; readonly value: ParsedDraftForm }
  | { readonly ok: false; readonly issues: readonly MaterialValidationIssue[] } {
  const parsed = formSchema.safeParse({
    access: formData.get("access"),
    document: formData.get("document"),
    formatId: formData.get("formatId"),
    submissionId: formData.get("submissionId"),
    seriesIds: formData.get("seriesIds"),
    summary: formData.get("summary"),
    tagIds: formData.getAll("tagIds"),
    title: formData.get("title"),
    topicId: formData.get("topicId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        message: formIssueMessage(String(issue.path[0] ?? "form")),
        path: `/${issue.path.map(String).join("/")}`,
      })),
    };
  }
  let document: unknown;
  let seriesIds: unknown;
  try {
    document = JSON.parse(parsed.data.document) as unknown;
    seriesIds = JSON.parse(parsed.data.seriesIds) as unknown;
  } catch {
    return {
      ok: false,
      issues: [{ message: "Содержимое редактора повреждено. Обновите страницу.", path: "/document" }],
    };
  }
  const parsedDocument = materialDocumentSchema.safeParse(document);
  const parsedSeriesIds = z.array(z.uuid()).max(100).safeParse(seriesIds);
  if (!parsedDocument.success || !parsedSeriesIds.success) {
    return {
      ok: false,
      issues: [{ message: "Содержимое редактора имеет неверную структуру.", path: "/document" }],
    };
  }
  return {
    ok: true,
    value: {
      access: parsed.data.access,
      document: parsedDocument.data,
      formatId: parsed.data.formatId === "unassigned" ? null : parsed.data.formatId,
      idempotencyKey: `web-create-${parsed.data.submissionId}`,
      seriesIds: parsedSeriesIds.data,
      summary: parsed.data.summary,
      tagIds: parsed.data.tagIds,
      title: parsed.data.title,
      topicId: parsed.data.topicId === "unassigned" ? null : parsed.data.topicId,
    },
  };
}

function mapValidation(
  result: BackendTransportResult,
):
  | { readonly kind: "ready"; readonly validation: CreatedMaterialDraft["validation"] }
  | Extract<CreateMaterialDraftActionState, { readonly kind: "unexpected_error" }> {
  if (result.ok) {
    const parsed = validationSchema.safeParse(result.body);
    return parsed.success
      ? {
          kind: "ready",
          validation: {
            headingCount: parsed.data.extraction.headings.length,
            kind: "valid",
            plainTextLength: parsed.data.extraction.plainText.length,
          },
        }
      : unexpected(parsed.error);
  }
  const problem = problemSchema.safeParse(result.problem);
  if (
    problem.success &&
    result.response.status === 422 &&
    problem.data.code === "invalid_content" &&
    problem.data.issues !== undefined
  ) {
    return {
      kind: "ready",
      validation: {
        issues: problem.data.issues.map(mapBackendIssue),
        kind: "invalid",
        scope: "publication",
      },
    };
  }
  return unexpected(problem.success ? problem.data : problem.error);
}

function mapMutationProblem(result: Extract<BackendTransportResult, { readonly ok: false }>): CreateMaterialDraftActionState {
  const parsed = problemSchema.safeParse(result.problem);
  if (result.response.status === 401) return { kind: "unauthorized" };
  if (result.response.status === 403) return { kind: "forbidden" };
  if (
    parsed.success &&
    (result.response.status === 400 || result.response.status === 422) &&
    parsed.data.issues !== undefined
  ) {
    return {
      issues: parsed.data.issues.map(mapBackendIssue),
      kind: "invalid_input",
    };
  }
  return {
    kind: "unexpected_error",
    reference: parsed.success ? parsed.data.correlationId ?? parsed.data.code : "backend-response",
  };
}

function mapBackendIssue(issue: { readonly code: string; readonly path: string }): MaterialValidationIssue {
  const message =
    issue.path.endsWith("/topicId")
      ? "Назначьте тему перед публикацией."
      : issue.path.endsWith("/formatId")
        ? "Назначьте формат перед публикацией."
        : issue.path.endsWith("/slug")
          ? "Адрес материала будет создан автоматически при публикации."
          : `Проверьте поле ${issue.path}.`;
  return { message, path: issue.path };
}

function formIssueMessage(field: string): string {
  switch (field) {
    case "title":
      return "Укажите название до 160 символов.";
    case "summary":
      return "Укажите краткое описание до 500 символов.";
    case "formatId":
      return "Выберите формат из списка.";
    case "topicId":
      return "Выберите тему из списка.";
    default:
      return "Проверьте данные черновика и повторите создание.";
  }
}

function unexpected(error: unknown): Extract<CreateMaterialDraftActionState, { readonly kind: "unexpected_error" }> {
  const reference =
    error instanceof BackendConnectionError ? error.code : "unexpected-authoring-error";
  return { kind: "unexpected_error", reference };
}
