"use client";

import { memo } from "react";

import { MaterialDocumentEditor } from "./material-document-editor.client";
import {
  MaterialAuthoringBlockingState,
  MaterialAuthoringHeader,
  MaterialAuthoringNotice,
} from "./material-authoring-chrome.client";
import { MaterialMetadataPanel } from "./material-metadata-panel.client";
import { MaterialVideoAuthoring } from "@/features/material-video";
import { ContentCoverEditor } from "@/features/content-covers";
import { ProductRemovalConfirmationDialog } from "@/shared/ui/product-removal-confirmation-dialog.client";
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
function MaterialAuthoringWorkspaceView({
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
      <MaterialAuthoringBlockingState
        actions={actions}
        presentation={presentation}
      />
      <MaterialAuthoringNotice presentation={presentation} />
      {presentation.draft.sourcePath === undefined ? null : (
        <p className="mx-auto max-w-[60rem] px-4 pt-4 text-sm text-muted-foreground sm:px-8">
          Материал редактируется в Inside Content:{" "}
          <span className="break-all">{presentation.draft.sourcePath}</span>.
          Сохраните оригинал в Obsidian, создайте коммит в Inside Content и
          выполните локальную синхронизацию из Git.
        </p>
      )}
      {presentation.removalConfirmation === undefined ||
      presentation.removalConfirmation === null ? null : (
        <ProductRemovalConfirmationDialog
          products={presentation.removalConfirmation.products}
          onCancel={actions.onCancelProductRemoval}
          onConfirm={actions.onConfirmProductRemoval}
          pending={presentation.removalConfirmation.pending}
        />
      )}

      <form
        className="mx-auto grid w-full max-w-[60rem] min-w-0 gap-0 px-4 pb-14 pt-7 sm:px-8"
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
            event.nativeEvent instanceof SubmitEvent
              ? event.nativeEvent.submitter
              : null;
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
        <section aria-labelledby="document-heading" className="min-w-0 py-8">
          <h2 className="text-sm font-semibold" id="document-heading">
            Содержимое материала
          </h2>
          {presentation.draft.materialId === null ? null : (
            <div className="mt-4">
              <ContentCoverEditor
                disabled={
                  presentation.blocking.kind === "not_found" ||
                  presentation.draft.readOnly
                }
                initialCover={presentation.draft.cover ?? null}
                ownerId={presentation.draft.materialId}
                ownerLabel={presentation.draft.title}
                ownerKind="material"
              />
            </div>
          )}
          <MaterialVideoAuthoring
            access={presentation.draft.access}
            disabled={
              presentation.blocking.kind === "not_found" ||
              presentation.draft.readOnly
            }
            materialId={presentation.draft.materialId}
            onChange={actions.onPrimaryVideoChange}
            deleteVideoId={presentation.draft.deleteVideoId}
            latestVideoDeletion={presentation.draft.latestVideoDeletion}
            key={`${presentation.draft.materialId ?? "new"}:${presentation.draft.access}`}
            primaryVideo={presentation.draft.primaryVideo}
            unselectedUpload={presentation.draft.unselectedVideoUpload}
          />
          <MaterialDocumentEditor
            saveState={presentation.save}
            disabled={
              presentation.blocking.kind === "not_found" ||
              presentation.draft.readOnly
            }
            contentVersion={presentation.draft.contentVersion}
            assetPreviewBlocks={presentation.draft.assetPreviewBlocks}
            document={presentation.draft.document}
            materialId={presentation.draft.materialId}
            onChange={actions.onDocumentChange}
          />
        </section>
      </form>
    </main>
  );
}

// The editor owns its mounted document (#602). A document edit only changes the surrounding
// workspace when a displayed fact changes, such as the save label or publication validation.
function sameWorkspaceProps(
  previous: MaterialAuthoringWorkspaceProps,
  next: MaterialAuthoringWorkspaceProps,
): boolean {
  if (previous.actions !== next.actions) return false;
  const { document: _previousDocument, ...previousDraft } =
    previous.presentation.draft;
  const { document: _nextDocument, ...nextDraft } = next.presentation.draft;
  if (!shallowEqual(previousDraft, nextDraft)) return false;
  const { draft: _previousDraft, ...previousPresentation } =
    previous.presentation;
  const { draft: _nextDraft, ...nextPresentation } = next.presentation;
  const nextValues = new Map<string, unknown>(Object.entries(nextPresentation));
  const previousValues = Object.entries(previousPresentation);
  return (
    previousValues.length === nextValues.size &&
    previousValues.every(([key, value]) => {
      const candidate = nextValues.get(key);
      return (
        nextValues.has(key) &&
        (Object.is(value, candidate) ||
          (typeof value === "object" &&
            value !== null &&
            typeof candidate === "object" &&
            candidate !== null &&
            shallowEqual(value, candidate)))
      );
    })
  );
}

function shallowEqual(previous: object, next: object): boolean {
  const nextValues = new Map<string, unknown>(Object.entries(next));
  const previousValues = Object.entries(previous);
  return (
    previousValues.length === nextValues.size &&
    previousValues.every(
      ([key, value]) =>
        nextValues.has(key) && Object.is(value, nextValues.get(key)),
    )
  );
}

export const MaterialAuthoringWorkspace = memo(
  MaterialAuthoringWorkspaceView,
  sameWorkspaceProps,
);
