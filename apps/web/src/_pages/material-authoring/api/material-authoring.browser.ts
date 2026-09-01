import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { CreateMaterialDraftActionState } from "../model/create-material-draft-state";
import type { SaveMaterialActionState } from "../model/save-material-state";

const issueSchema = z.object({ message: z.string(), path: z.string() }).strict();
const createStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), draft: z.object({ contentVersion: z.number().int().positive(), materialId: z.uuid() }).strict() }).strict(),
  z.object({ kind: z.literal("invalid_input"), issues: z.array(issueSchema) }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);
const saveStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentVersion: z.number().int().positive(),
      kind: z.literal("saved"),
      nextSubmissionId: z.uuid(),
      publicationState: z.enum(["draft", "published", "unpublished"]),
    })
    .strict(),
  z.object({ kind: z.literal("invalid_input"), issues: z.array(issueSchema) }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("not_found") }).strict(),
  z
    .object({
      currentContentVersion: z.number().int().positive(),
      kind: z.literal("conflict"),
      staleContentVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("infrastructure_error"), reference: z.string() }).strict(),
]);

export function createMaterialDraft(
  formData: FormData,
): Promise<CreateMaterialDraftActionState> {
  return mutateMaterial("POST", formData, createStateSchema, {
    kind: "unexpected_error",
    reference: "material-create-bff",
  });
}

export function saveMaterial(
  formData: FormData,
): Promise<SaveMaterialActionState> {
  return mutateMaterial("PUT", formData, saveStateSchema, {
    kind: "infrastructure_error",
    reference: "material-save-bff",
  });
}

async function mutateMaterial<State>(
  method: "POST" | "PUT",
  formData: FormData,
  schema: z.ZodType<State>,
  unavailable: State,
): Promise<State> {
  const result = await requestSameOriginMutation(
    "/api/authoring/materials",
    method,
    formData,
  );
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return { kind: "unauthorized" } as State;
    }
    return unavailable;
  }
  const parsed = schema.safeParse(result.body);
  return parsed.success ? parsed.data : unavailable;
}
