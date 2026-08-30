import {
  MaterialAuthoringPreviewUnauthorizedState,
  MaterialAuthoringPreviewNotFoundState,
  MaterialAuthoringUnexpectedPreviewState,
  MaterialCurrentPreview,
} from "@/features/material-authoring";
import {
  getPlatformAccessTokenRsc,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getCurrentMaterialPreview } from "../api/get-current-material-preview";
export async function MaterialCurrentPreviewPage({
  materialId,
}: {
  readonly materialId: string;
}) {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return <MaterialAuthoringPreviewUnauthorizedState />;
    }
    return (
      <MaterialAuthoringUnexpectedPreviewState
        reference="identity-session"
        retryHref={`/authoring/materials/${materialId}/preview`}
      />
    );
  }

  const state = await getCurrentMaterialPreview(materialId, accessToken);
  if (state.kind === "unauthorized") {
    return <MaterialAuthoringPreviewUnauthorizedState />;
  }
  if (state.kind === "not_found") {
    return <MaterialAuthoringPreviewNotFoundState />;
  }
  if (state.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedPreviewState
        reference={state.reference}
        retryHref={`/authoring/materials/${materialId}/preview`}
      />
    );
  }
  return (
    <MaterialCurrentPreview
      editorHref={`/authoring/materials/${materialId}`}
      preview={state.preview}
    />
  );
}
