import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  BackendConnectionError,
  requestAuthoringMaterials,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type {
  AuthoringMaterialsQuery,
  AuthoringMaterialsState,
} from "../model/authoring-materials-presentation";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);
const referenceSchema = z.object({ id: z.uuid(), name: z.string().min(1) }).strict();
const responseSchema = z
  .object({
    items: z.array(
      z
        .object({
          canDelete: z.boolean(),
          contentVersion: z.number().int().positive(),
          format: referenceSchema.nullable(),
          materialId: z.uuid(),
          publicationState: publicationStateSchema,
          title: z.string().nullable(),
          topic: referenceSchema.nullable(),
          updatedAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface AuthoringMaterialsDependencies {
  readonly list: typeof requestAuthoringMaterials;
}

const productionDependencies: AuthoringMaterialsDependencies = {
  list: requestAuthoringMaterials,
};

export async function getAuthoringMaterials(
  query: AuthoringMaterialsQuery,
  accessToken: string,
  dependencies: AuthoringMaterialsDependencies = productionDependencies,
): Promise<AuthoringMaterialsState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.list(query, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError) {
      if (error.code === "unavailable") {
        return { kind: "unavailable", reference: error.code };
      }
      if (error.code === "invalid-response") {
        return { kind: "malformed_response" };
      }
    }
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "signed_out" };
    if (result.response.status === 403) return { kind: "forbidden" };
    const problem = problemSchema.safeParse(result.problem);
    if (
      result.response.status === 503 &&
      problem.success &&
      problem.data.code === "dependency_unavailable"
    ) {
      return {
        kind: "unavailable",
        reference: problem.data.correlationId ?? problem.data.code,
      };
    }
    if (
      result.response.status === 500 &&
      problem.success &&
      problem.data.code === "internal_error"
    ) {
      return {
        kind: "unexpected_error",
        reference: problem.data.correlationId ?? problem.data.code,
      };
    }
    return { kind: "malformed_response" };
  }

  const parsed = responseSchema.safeParse(result.body);
  if (!parsed.success) return { kind: "malformed_response" };
  return {
    kind: "ready",
    items: parsed.data.items.map((item) => ({
      canDelete: item.canDelete,
      contentVersion: item.contentVersion,
      format: item.format?.name ?? null,
      materialId: item.materialId,
      publicationState: item.publicationState,
      submissionId: randomUUID(),
      title: item.title,
      topic: item.topic?.name ?? null,
      updatedAt: item.updatedAt,
    })),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalItems: parsed.data.totalItems,
    totalPages: parsed.data.totalPages,
  };
}
