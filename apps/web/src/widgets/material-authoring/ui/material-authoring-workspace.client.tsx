"use client";

import { MaterialDocumentEditor } from "./material-document-editor.client";
import {
  MaterialAuthoringBlockingState,
  MaterialAuthoringHeader,
  MaterialAuthoringNotice,
} from "./material-authoring-chrome.client";
import { MaterialCurrentPreview } from "./material-current-preview";
import { MaterialMetadataPanel } from "./material-metadata-panel.client";
import { MaterialVideoAuthoring } from "@/features/material-video";
import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "./material-authoring-route-states";
import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
} from "../model/presentation";

interface MaterialAuthoringWorkspaceProps {
  readonly actions: MaterialAuthoringActions;
  readonly presentation: MaterialAuthoringPresentation;
}

/** Composes the editor from a serializable presentation contract. */
export function MaterialAuthoringWorkspace({
  actions,
  presentation,
}: MaterialAuthoringWorkspaceProps) {
  if (presentation.authorization.kind === "unauthorized") {
    return (
      <MaterialAuthoringUnauthorizedState
        action={<MaterialAuthoringSignInActions onBack={actions.onBack} />}
        context="editor"
      />
    );
  }

  if (presentation.mode === "preview" && presentation.preview !== null) {
    return (
      <MaterialCurrentPreview
        editorHref={
          presentation.draft.materialId === null
            ? "/authoring/materials/new"
            : `/authoring/materials/${presentation.draft.materialId}`
        }
        preview={presentation.preview}
      />
    );
  }

  const canSave =
    presentation.save.kind === "dirty" &&
    presentation.blocking.kind === "none" &&
    !presentation.draft.readOnly;

  return (
    <main
      aria-labelledby="material-editor-heading"
      className="@container/material-authoring h-full min-h-svh overflow-x-hidden bg-background text-foreground md:min-h-0 md:overflow-y-auto md:overscroll-y-contain"
      data-material-authoring
      id="authoring-content"
      tabIndex={-1}
    >
      <MaterialAuthoringHeader
        actions={actions}
        canSave={canSave}
        presentation={presentation}
      />
      <MaterialAuthoringBlockingState actions={actions} presentation={presentation} />
      <MaterialAuthoringNotice presentation={presentation} />

      <form
        className="mx-auto grid w-full max-w-[52rem] min-w-0 gap-0 px-4 pb-14 pt-7 sm:px-6 @min-[68rem]/material-authoring:max-w-[80rem] @min-[68rem]/material-authoring:grid-cols-[minmax(18rem,0.72fr)_minmax(32rem,1.55fr)] @min-[68rem]/material-authoring:px-8 @min-[68rem]/material-authoring:pt-9"
        id="material-authoring-form"
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.defaultPrevented ||
            !(event.target instanceof HTMLInputElement) ||
            event.target.type !== "text" ||
            presentation.draft.status === "new"
          ) {
            return;
          }
          event.preventDefault();
          if (canSave) {
            event.currentTarget.requestSubmit();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const submitter =
            event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
          const requestedPublicationState =
            submitter instanceof HTMLButtonElement &&
            submitter.name === "publicationState"
              ? submitter.value
              : presentation.draft.status;
          actions.onSave(
            requestedPublicationState === "published" ||
              requestedPublicationState === "unpublished"
              ? requestedPublicationState
              : "draft",
          );
        }}
      >
        <MaterialMetadataPanel actions={actions} presentation={presentation} />
        <section
          aria-labelledby="document-heading"
          className="min-w-0 py-8 @min-[68rem]/material-authoring:px-8 @min-[68rem]/material-authoring:py-0"
        >
          <h2 className="text-sm font-semibold" id="document-heading">
            Содержимое материала
          </h2>
          <MaterialVideoAuthoring
            access={presentation.draft.access}
            disabled={
              presentation.save.kind === "submitting" ||
              presentation.blocking.kind !== "none" ||
              presentation.draft.readOnly
            }
            materialId={presentation.draft.materialId}
            onChange={actions.onPrimaryVideoChange}
            primaryVideoId={presentation.draft.primaryVideoId}
          />
          <MaterialDocumentEditor
            disabled={
              presentation.save.kind === "submitting" ||
              presentation.blocking.kind !== "none" ||
              presentation.draft.readOnly
            }
            document={presentation.draft.document}
            materialId={presentation.draft.materialId}
            onChange={actions.onDocumentChange}
          />
        </section>
      </form>
    </main>
  );
}
