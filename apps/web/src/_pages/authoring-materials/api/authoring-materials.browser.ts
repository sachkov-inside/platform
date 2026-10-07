import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { z } from "zod";

import type {
  AuthoringMaterialsQuery,
  AuthoringMaterialsState,
} from "../model/authoring-materials-presentation";
import { serializeAuthoringMaterialsQuery } from "../model/authoring-materials-query";

const itemSchema = z
  .object({
    canDelete: z.boolean(),
    contentVersion: z.number().int().positive(),
    format: z.string().nullable(),
    materialId: z.uuid(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    submissionId: z.uuid(),
    title: z.string().nullable(),
    topic: z.string().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const stateSchema: z.ZodType<AuthoringMaterialsState> = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        items: z.array(itemSchema),
        kind: z.literal("ready"),
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        totalItems: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ kind: z.literal("signed_out") }).strict(),
    z.object({ kind: z.literal("forbidden") }).strict(),
    z
      .object({ kind: z.literal("unavailable"), reference: z.string() })
      .strict(),
    z.object({ kind: z.literal("malformed_response") }).strict(),
    z
      .object({ kind: z.literal("unexpected_error"), reference: z.string() })
      .strict(),
  ],
);

export async function requestAuthoringMaterials(
  query: AuthoringMaterialsQuery,
  signal: AbortSignal,
): Promise<AuthoringMaterialsState> {
  const search = serializeAuthoringMaterialsQuery(query);
  const result = await requestAuthenticatedRead(
    search === ""
      ? "/api/authoring/materials"
      : `/api/authoring/materials?${search}`,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind !== "ready")
    return { kind: "unavailable", reference: "authoring-session" };
  const parsed = stateSchema.safeParse(result.value);
  if (!parsed.success) {
    throw new Error("Authoring Materials response is malformed", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
