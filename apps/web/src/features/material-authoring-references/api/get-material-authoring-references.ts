import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestMaterialAuthoringReferences,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const referenceSchema = z.object({ archived: z.boolean(), id: z.uuid(), name: z.string().min(1) }).strict();
const referencesSchema = z
  .object({
    formats: z.array(referenceSchema),
    series: z.array(referenceSchema),
    tags: z.array(referenceSchema),
    topics: z.array(referenceSchema),
  })
  .strict();

export interface MaterialAuthoringReferences {
  readonly formats: readonly MaterialAuthoringReference[];
  readonly series: readonly MaterialAuthoringReference[];
  readonly tags: readonly MaterialAuthoringReference[];
  readonly topics: readonly MaterialAuthoringReference[];
}

export interface MaterialAuthoringReference {
  readonly archived: boolean;
  readonly label: string;
  readonly value: string;
}

export type MaterialAuthoringReferencesState =
  | { readonly kind: "ready"; readonly references: MaterialAuthoringReferences }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unexpected_error"; readonly reference: string };

export async function getMaterialAuthoringReferences(
  accessToken: string,
  request: typeof requestMaterialAuthoringReferences = requestMaterialAuthoringReferences,
): Promise<MaterialAuthoringReferencesState> {
  let result: BackendTransportResult;
  try {
    result = await request(accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unexpected_error", reference: error.code };
    }
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.response.status === 503) {
      return { kind: "unexpected_error", reference: "authoring-references-response" };
    }
    throw new TypeError("Unexpected Material authoring references response");
  }
  const parsed = referencesSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new TypeError("Malformed Material authoring references response");
  }
  return {
    kind: "ready",
    references: {
      formats: parsed.data.formats.map(toOption),
      series: parsed.data.series.map(toOption),
      tags: parsed.data.tags.map(toOption),
      topics: parsed.data.topics.map(toOption),
    },
  };
}

function toOption(reference: { readonly archived: boolean; readonly id: string; readonly name: string }) {
  return { archived: reference.archived, label: reference.name, value: reference.id };
}
