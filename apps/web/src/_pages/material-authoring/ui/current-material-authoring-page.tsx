import { randomUUID } from "node:crypto";

import {
  MaterialAuthoringNotFoundState,
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
  MaterialAuthoringUnexpectedEditorState,
  type MaterialAuthoringPresentation,
} from "@/features/material-authoring";
import {
  getPlatformAccessTokenRsc,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getCurrentMaterial } from "../api/get-current-material";
import { saveMaterialAction } from "../api/save-material.action";
import { MaterialAuthoringPageClient } from "./material-authoring-page.client";

export async function CurrentMaterialAuthoringPage({
  materialId,
}: {
  readonly materialId: string;
}) {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return (
        <MaterialAuthoringUnauthorizedState
          action={<MaterialAuthoringSignInActions />}
          context="editor"
        />
      );
    }
    throw error;
  }

  const state = await getCurrentMaterial(materialId, accessToken);
  if (state.kind === "unauthorized") {
    return (
      <MaterialAuthoringUnauthorizedState
        action={<MaterialAuthoringSignInActions />}
        context="editor"
      />
    );
  }
  if (state.kind === "not_found") {
    return <MaterialAuthoringNotFoundState />;
  }
  if (state.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedEditorState
        reference={state.reference}
        retryHref={`/authoring/materials/${materialId}`}
      />
    );
  }

  const initialPresentation: MaterialAuthoringPresentation = {
    availableFormats: state.references.references.formats,
    availableSeries: state.references.references.series,
    availableTags: state.references.references.tags,
    availableTopics: state.references.references.topics,
    authorization: { kind: "allowed" },
    blocking: { kind: "none" },
    draft: state.draft,
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
      key={materialId}
      mutationAction={saveMaterialAction}
    />
  );
}
