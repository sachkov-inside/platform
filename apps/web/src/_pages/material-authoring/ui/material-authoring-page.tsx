import { randomUUID } from "node:crypto";
import type { Route } from "next";

import {
  MaterialAuthoringUnexpectedEditorState,
  type MaterialAuthoringPresentation,
  withAuthoringReturnHref,
} from "@/features/material-authoring";
import { mutateMaterialLifecycleAction } from "@/features/material-authoring.server";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";

import { createMaterialDraftAction } from "../api/create-material-draft.action";
import { getMaterialAuthoringReferences } from "../api/get-material-authoring-references";
import { MaterialAuthoringPageClient } from "./material-authoring-page.client";

export async function MaterialAuthoringPage({ returnHref }: { readonly returnHref: Route }) {
  const session = await resolvePlatformSession();
  if (session.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedEditorState
        reference="identity-session"
        retryHref={withAuthoringReturnHref("/authoring/materials/new", returnHref)}
        returnHref={returnHref}
      />
    );
  }
  const references =
    session.kind === "allowed"
      ? await getMaterialAuthoringReferences(session.accessToken)
      : null;
  if (references?.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedEditorState
        reference={references.reference}
        retryHref={withAuthoringReturnHref("/authoring/materials/new", returnHref)}
        returnHref={returnHref}
      />
    );
  }
  const initialPresentation: MaterialAuthoringPresentation = {
    availableFormats: references?.kind === "ready" ? references.references.formats : [],
    availableSeries: references?.kind === "ready" ? references.references.series : [],
    availableTags: references?.kind === "ready" ? references.references.tags : [],
    availableTopics: references?.kind === "ready" ? references.references.topics : [],
    authorization: {
      kind:
        session.kind === "allowed" && references?.kind === "ready"
          ? "allowed"
          : "unauthorized",
    },
    blocking: { kind: "none" },
    deletion: { pending: false, state: { kind: "idle" } },
    draft: {
      access: "free",
      canDelete: false,
      contentVersion: null,
      document: { content: [{ type: "paragraph" }], type: "doc" },
      formatId: "unassigned",
      materialId: null,
      readOnly: false,
      seriesIds: [],
      status: "new",
      summary: "",
      tagIds: [],
      title: "",
      topicId: "unassigned",
    },
    mode: "editor",
    noticeRevision: 0,
    preview: null,
    save: { kind: "clean" },
    submissionId: randomUUID(),
    validation: { kind: "idle" },
  };
  return (
    <MaterialAuthoringPageClient
      initialPresentation={initialPresentation}
      key="new-material"
      lifecycleAction={mutateMaterialLifecycleAction}
      mutationAction={createMaterialDraftAction}
      returnHref={returnHref}
    />
  );
}

async function resolvePlatformSession(): Promise<
  | { readonly accessToken: string; readonly kind: "allowed" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unexpected_error" }
> {
  try {
    const accessToken = await getOptionalPlatformAccessToken();
    return accessToken === undefined
      ? { kind: "unauthorized" }
      : { accessToken, kind: "allowed" };
  } catch (error) {
    return error instanceof LogtoSessionUnavailableError
      ? { kind: "unauthorized" }
      : { kind: "unexpected_error" };
  }
}
