import { randomUUID } from "node:crypto";
import type { Route } from "next";

import {
  MaterialAuthoringNotFoundState,
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
  MaterialAuthoringUnexpectedEditorState,
  type MaterialAuthoringPresentation,
  withAuthoringReturnHref,
} from "@/features/material-authoring";
import { mutateMaterialLifecycleAction } from "@/features/material-authoring.server";
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
  returnHref,
}: {
  readonly materialId: string;
  readonly returnHref: Route;
}) {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return (
        <MaterialAuthoringUnauthorizedState
          action={<MaterialAuthoringSignInActions returnHref={returnHref} />}
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
        action={<MaterialAuthoringSignInActions returnHref={returnHref} />}
        context="editor"
      />
    );
  }
  if (state.kind === "not_found") {
    return <MaterialAuthoringNotFoundState returnHref={returnHref} />;
  }
  if (state.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedEditorState
        reference={state.reference}
        retryHref={withAuthoringReturnHref(`/authoring/materials/${materialId}`, returnHref)}
        returnHref={returnHref}
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
    deletion: { pending: false, state: { kind: "idle" } },
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
      lifecycleAction={mutateMaterialLifecycleAction}
      mutationAction={saveMaterialAction}
      returnHref={returnHref}
    />
  );
}
