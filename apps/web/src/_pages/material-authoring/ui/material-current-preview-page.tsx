import {
  MaterialAuthoringPreviewUnauthorizedState,
  MaterialAuthoringPreviewNotFoundState,
  MaterialAuthoringUnexpectedPreviewState,
} from "@/widgets/material-authoring/route-states";
import { MaterialCurrentPreview } from "@/widgets/material-authoring/preview";
import { withAuthoringReturnHref } from "@/shared/routing/authoring";
import type { Route } from "next";
import {
  getPlatformAccessTokenRsc,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getCurrentMaterialPreview } from "../api/get-current-material-preview";
export async function MaterialCurrentPreviewPage({
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
      return <MaterialAuthoringPreviewUnauthorizedState returnHref={returnHref} />;
    }
    return (
      <MaterialAuthoringUnexpectedPreviewState
        editorHref={withAuthoringReturnHref(`/authoring/materials/${materialId}`, returnHref)}
        reference="identity-session"
        retryHref={withAuthoringReturnHref(`/authoring/materials/${materialId}/preview`, returnHref)}
        returnHref={returnHref}
      />
    );
  }

  const state = await getCurrentMaterialPreview(materialId, accessToken);
  if (state.kind === "unauthorized") {
    return <MaterialAuthoringPreviewUnauthorizedState returnHref={returnHref} />;
  }
  if (state.kind === "not_found") {
    return (
      <MaterialAuthoringPreviewNotFoundState
        editorHref={withAuthoringReturnHref(`/authoring/materials/${materialId}`, returnHref)}
        returnHref={returnHref}
      />
    );
  }
  if (state.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedPreviewState
        editorHref={withAuthoringReturnHref(`/authoring/materials/${materialId}`, returnHref)}
        reference={state.reference}
        retryHref={withAuthoringReturnHref(`/authoring/materials/${materialId}/preview`, returnHref)}
        returnHref={returnHref}
      />
    );
  }
  return (
    <MaterialCurrentPreview
      editorHref={withAuthoringReturnHref(`/authoring/materials/${materialId}`, returnHref)}
      materialsHref={returnHref}
      preview={state.preview}
    />
  );
}
