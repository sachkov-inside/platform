import {
  MaterialAuthoringPreviewUnauthorizedState,
  MaterialAuthoringPreviewNotFoundState,
  MaterialAuthoringUnexpectedPreviewState,
} from "@/widgets/material-authoring/route-states";
import { MaterialCurrentPreview } from "@/widgets/material-authoring/preview";
import {
  authoringMaterialPreviewHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";
import type { Route } from "next";
import {
  getPlatformAccessTokenRsc,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getCurrentMaterialPreview } from "../api/get-current-material-preview";
import {
  getMaterialPreviewRoute,
  getMaterialPreviewVideo,
} from "../api/get-material-preview-context";
export async function MaterialCurrentPreviewPage({
  productId,
  materialId,
  returnHref,
}: {
  readonly productId?: string | undefined;
  readonly materialId: string;
  readonly returnHref: Route;
}) {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return (
        <MaterialAuthoringPreviewUnauthorizedState returnHref={returnHref} />
      );
    }
    return (
      <MaterialAuthoringUnexpectedPreviewState
        editorHref={withAuthoringReturnHref(
          `/authoring/materials/${materialId}`,
          returnHref,
        )}
        reference="identity-session"
        retryHref={authoringMaterialPreviewHref(
          materialId,
          returnHref,
          productId,
        )}
        returnHref={returnHref}
      />
    );
  }

  const state = await getCurrentMaterialPreview(materialId, accessToken);
  if (state.kind === "unauthorized") {
    return (
      <MaterialAuthoringPreviewUnauthorizedState returnHref={returnHref} />
    );
  }
  if (state.kind === "not_found") {
    return (
      <MaterialAuthoringPreviewNotFoundState
        editorHref={withAuthoringReturnHref(
          `/authoring/materials/${materialId}`,
          returnHref,
        )}
        returnHref={returnHref}
      />
    );
  }
  if (state.kind === "unexpected_error") {
    return (
      <MaterialAuthoringUnexpectedPreviewState
        editorHref={withAuthoringReturnHref(
          `/authoring/materials/${materialId}`,
          returnHref,
        )}
        reference={state.reference}
        retryHref={authoringMaterialPreviewHref(
          materialId,
          returnHref,
          productId,
        )}
        returnHref={returnHref}
      />
    );
  }
  const [route, video] = await Promise.all([
    getMaterialPreviewRoute({
      accessToken,
      productId,
      products: state.products,
      materialId: state.preview.materialId,
      returnHref,
    }),
    getMaterialPreviewVideo(state.preview.materialId, accessToken),
  ]);
  if (route === "unauthorized") {
    return (
      <MaterialAuthoringPreviewUnauthorizedState returnHref={returnHref} />
    );
  }
  return (
    <MaterialCurrentPreview
      editorHref={withAuthoringReturnHref(
        `/authoring/materials/${materialId}`,
        returnHref,
      )}
      materialsHref={returnHref}
      preview={{ ...state.preview, video }}
      route={route}
    />
  );
}
