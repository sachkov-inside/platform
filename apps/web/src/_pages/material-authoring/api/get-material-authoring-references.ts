import "server-only";

import { z } from "zod";

import type { MaterialSelectOption } from "@/features/material-authoring";
import {
  BackendConnectionError,
  requestMaterialAuthoringReferences,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const referenceSchema = z.object({ id: z.uuid(), name: z.string().min(1) }).strict();
const referencesSchema = z
  .object({
    formats: z.array(referenceSchema),
    tags: z.array(referenceSchema),
    topics: z.array(referenceSchema),
  })
  .strict();

export interface MaterialAuthoringReferences {
  readonly formats: readonly MaterialSelectOption[];
  readonly tags: readonly MaterialSelectOption[];
  readonly topics: readonly MaterialSelectOption[];
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
    return {
      kind: "unexpected_error",
      reference:
        error instanceof BackendConnectionError
          ? error.code
          : "unexpected-authoring-references-error",
    };
  }
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    return { kind: "unexpected_error", reference: "authoring-references-response" };
  }
  const parsed = referencesSchema.safeParse(result.body);
  if (!parsed.success) {
    return { kind: "unexpected_error", reference: "authoring-references-shape" };
  }
  return {
    kind: "ready",
    references: {
      formats: parsed.data.formats.map(toOption),
      tags: parsed.data.tags.map(toOption),
      topics: parsed.data.topics.map(toOption),
    },
  };
}

function toOption(reference: { readonly id: string; readonly name: string }) {
  return { label: reference.name, value: reference.id };
}
