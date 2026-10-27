import "server-only";

import { getMaterialAuthoringReferences } from "@/features/material-authoring-references.server";
import { materialFormatSchema } from "@/shared/api/material-format";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import type { AuthoringMaterialFilterOptions } from "../model/authoring-materials-presentation";

type ReadyFilterOptions = Extract<
  AuthoringMaterialFilterOptions,
  { readonly kind: "ready" }
>;

export interface AuthoringMaterialFiltersDependencies {
  readonly references: typeof getMaterialAuthoringReferences;
}

const productionDependencies: AuthoringMaterialFiltersDependencies = {
  references: getMaterialAuthoringReferences,
};

/**
 * `GET /api/authoring/materials/references`: the Topic and format choices of the Materials list
 * filters, read from the same authoring references as the Material editor. The answer carries only
 * these two lists; Products and tags stay with the editor.
 */
export function handleAuthoringMaterialFiltersRequest(
  dependencies: AuthoringMaterialFiltersDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const state = await dependencies.references(accessToken);
    if (state.kind === "unauthorized")
      return Response.json({ kind: "forbidden" }, { status: 403 });
    if (state.kind === "unexpected_error")
      return Response.json(
        { kind: "unavailable" },
        { headers: { "x-correlation-id": state.reference }, status: 503 },
      );
    return Response.json(materialFilterOptions(state.references));
  });
}

/**
 * Every Topic stays a choice: an archived one still holds Materials and says so in its label.
 * Formats are the closed set the backend names.
 */
export function materialFilterOptions(references: {
  readonly formats: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly topics: readonly {
    readonly archived: boolean;
    readonly label: string;
    readonly value: string;
  }[];
}): ReadyFilterOptions {
  return {
    kind: "ready",
    formats: references.formats.flatMap((format) => {
      const value = materialFormatSchema.safeParse(format.value);
      return value.success ? [{ label: format.label, value: value.data }] : [];
    }),
    topics: references.topics.map((topic) => ({
      label: topic.archived ? `${topic.label} (в архиве)` : topic.label,
      value: topic.value,
    })),
  };
}
