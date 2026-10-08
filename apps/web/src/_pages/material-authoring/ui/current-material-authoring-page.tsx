import { randomUUID } from "node:crypto";
import type { Route } from "next";

import {
  MaterialAuthoringNotFoundState,
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
  MaterialAuthoringUnexpectedEditorState,
} from "@/widgets/material-authoring/route-states";
import type { MaterialAuthoringPresentation } from "@/widgets/material-authoring/model";
import { withAuthoringReturnHref } from "@/shared/routing/authoring";
import { readAuthenticatedSession } from "@/shared/auth/index.server";

import { getCurrentMaterialPreview } from "../api/get-current-material-preview";
import { getCurrentMaterial } from "../api/get-current-material";
import { MaterialAuthoringPageClient } from "./material-authoring-page.client";

export async function CurrentMaterialAuthoringPage({
  materialId,
  returnHref,
}: {
  readonly materialId: string;
  readonly returnHref: Route;
}) {
  const session = await readAuthenticatedSession("rsc");
  if (session.kind !== "ready") {
    if (session.kind === "authentication_required") {
      return (
        <MaterialAuthoringUnauthorizedState
          action={<MaterialAuthoringSignInActions returnHref={returnHref} />}
          context="editor"
        />
      );
    }
    throw new Error("Identity session is unavailable");
  }
  const accessToken = session.value;

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
        retryHref={withAuthoringReturnHref(
          `/authoring/materials/${materialId}`,
          returnHref,
        )}
        returnHref={returnHref}
      />
    );
  }

  const assetPreview = await getCurrentMaterialPreview(materialId, accessToken);
  const initialPresentation: MaterialAuthoringPresentation = {
    availableFormats: state.references.references.formats,
    availableSeries: state.references.references.series,
    availableTags: state.references.references.tags,
    availableTopics: state.references.references.topics,
    authorization: { kind: "allowed" },
    blocking: { kind: "none" },
    deletion: { pending: false, result: null },
    draft: {
      ...state.draft,
      assetPreviewBlocks:
        assetPreview.kind === "ready" ? assetPreview.preview.blocks : [],
    },
    noticeRevision: 0,
    save: { kind: "clean" },
    submissionId: randomUUID(),
    validation: { kind: "idle" },
  };
  return (
    <MaterialAuthoringPageClient
      initialPresentation={initialPresentation}
      key={materialId}
      returnHref={returnHref}
    />
  );
}
