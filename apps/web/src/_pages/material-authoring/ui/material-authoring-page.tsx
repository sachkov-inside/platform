import { randomUUID } from "node:crypto";

import {
  MaterialAuthoringUnexpectedEditorState,
  type MaterialAuthoringPresentation,
} from "@/features/material-authoring";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";

import { createMaterialDraftAction } from "../api/create-material-draft.action";
import { getMaterialAuthoringReferences } from "../api/get-material-authoring-references";
import { MaterialAuthoringPageClient } from "./material-authoring-page.client";

export async function MaterialAuthoringPage() {
  const session = await resolvePlatformSession();
  if (session.kind === "unexpected_error") {
    return <MaterialAuthoringUnexpectedEditorState reference="identity-session" />;
  }
  const references =
    session.kind === "allowed"
      ? await getMaterialAuthoringReferences(session.accessToken)
      : null;
  if (references?.kind === "unexpected_error") {
    return <MaterialAuthoringUnexpectedEditorState reference={references.reference} />;
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
    draft: {
      access: "free",
      contentVersion: null,
      document: { content: [{ type: "paragraph" }], type: "doc" },
      formatId: "unassigned",
      materialId: null,
      readOnly: false,
      seriesMemberships: [],
      slug: "",
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
      mutationAction={createMaterialDraftAction}
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
