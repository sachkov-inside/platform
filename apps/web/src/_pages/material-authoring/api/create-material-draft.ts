import "server-only";

import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import type { MaterialValidationIssue } from "@/widgets/material-authoring/model";
import {
  BackendConnectionError,
  requestMaterialDraftCreation,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type {
  CreateMaterialDraftActionState,
  CreatedMaterialDraft,
} from "../model/create-material-draft-state";
import { parseMaterialDocumentFields } from "./parse-material-document-fields";
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
}

const productionDependencies: MaterialDraftWorkflowDependencies = {
  create: requestMaterialDraftCreation,
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

  const draft: CreatedMaterialDraft = {
    contentVersion: receipt.data.contentVersion,
    materialId: receipt.data.materialId,
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
  const documentFields = parseMaterialDocumentFields(parsed.data);
  if (!documentFields.ok) return documentFields;
  return {
    ok: true,
    value: {
      access: parsed.data.access,
      document: documentFields.document,
      formatId: parsed.data.formatId === "unassigned" ? null : parsed.data.formatId,
      idempotencyKey: `web-create-${parsed.data.submissionId}`,
      seriesIds: documentFields.seriesIds,
      summary: parsed.data.summary,
      tagIds: parsed.data.tagIds,
      title: parsed.data.title,
      topicId: parsed.data.topicId === "unassigned" ? null : parsed.data.topicId,
    },
  };
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
