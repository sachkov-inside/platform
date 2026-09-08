"use client";

import type { JSONContent } from "@tiptap/core";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import {
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
} from "@/widgets/material-authoring/editor";
import { deleteMaterialDraft } from "@/features/material-lifecycle";
import {
  flushPendingEdits,
  useAutosave,
} from "@/shared/lib/autosave/use-autosave";
import { withAuthoringReturnHref } from "@/shared/routing/authoring";

import { withMaterialNodeIds } from "@/widgets/material-authoring/model";
import { createMaterialDraft } from "../api/create-material-draft.browser";
import { saveMaterial } from "../api/save-material.browser";
import type { CreateMaterialDraftInput } from "../model/create-material-draft";
import type { SaveMaterialInput } from "../model/save-material";

interface MaterialAuthoringPageClientProps {
  readonly initialPresentation: MaterialAuthoringPresentation;
  readonly returnHref: Route;
}

export function MaterialAuthoringPageClient({
  initialPresentation,
  returnHref,
}: MaterialAuthoringPageClientProps) {
  const router = useRouter();
  const createMutation = useMutation({ mutationFn: createMaterialDraft });
  const saveMutation = useMutation({ mutationFn: saveMaterial });
  const deletionMutation = useMutation({
    mutationFn: deleteMaterialDraft,
    onSuccess: (result) => {
      if (result.kind === "deleted") router.replace(returnHref);
    },
  });
  const [draft, setDraft] = useState(initialPresentation.draft);
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const [materialResult, setMaterialResult] = useState<
    | Awaited<ReturnType<typeof createMaterialDraft>>
    | Awaited<ReturnType<typeof saveMaterial>>
    | null
  >(null);
  const retryCreateInput = useRef<CreateMaterialDraftInput | null>(null);
  const retrySaveInput = useRef<SaveMaterialInput | null>(null);
  const [publicationTarget, setPublicationTarget] = useState<
    SaveMaterialInput["publicationState"] | null
  >(null);
  const effectiveDraft = draft;
  const deletionResult = deletionMutation.data ?? null;
  const deletionPending = deletionMutation.isPending;
  const {
    contentVersion: _version,
    materialId: _id,
    assetPreviewBlocks: _blocks,
    cover: _cover,
    ...editable
  } = draft;
  const autosave = useAutosave({
    value: { ...editable, publicationTarget },
    enabled:
      !draft.readOnly &&
      draft.title.trim().length > 0 &&
      initialPresentation.authorization.kind !== "unauthorized",
    save: async (snapshot) => {
      const current = draftRef.current;
      if (current.materialId === null) {
        const input = retryCreateInput.current ?? {
          ...snapshot,
          document: withMaterialNodeIds(snapshot.document),
          submissionId: crypto.randomUUID(),
        };
        retryCreateInput.current = input;
        const result = await createMutation.mutateAsync(input);
        setMaterialResult(result);
        if (result.kind !== "created") {
          if (result.kind === "invalid_input") {
            retryCreateInput.current = null;
            return "invalid";
          }
          return "failed";
        }
        retryCreateInput.current = null;
        const next = {
          ...draftRef.current,
          ...result.draft,
          status: "draft" as const,
        };
        draftRef.current = next;
        setDraft(next);
        // Keep the editor and in-flight uploads mounted when the draft gets its URL.
        window.history.replaceState(
          null,
          "",
          withAuthoringReturnHref(
            `/authoring/materials/${result.draft.materialId}`,
            returnHref,
          ),
        );
        return "saved";
      }
      if (current.contentVersion === null) return "failed";
      const input: SaveMaterialInput = retrySaveInput.current ?? {
        ...snapshot,
        document: withMaterialNodeIds(snapshot.document),
        expectedContentVersion: current.contentVersion,
        materialId: current.materialId,
        publicationState:
          snapshot.publicationTarget ??
          (current.status === "new" ? "draft" : current.status),
        submissionId: crypto.randomUUID(),
      };
      retrySaveInput.current = input;
      const result = await saveMutation.mutateAsync(input);
      setMaterialResult(result);
      if (result.kind !== "saved") {
        if (result.kind === "invalid_input") {
          retrySaveInput.current = null;
          setPublicationTarget(null);
          return "invalid";
        }
        return "failed";
      }
      retrySaveInput.current = null;
      setPublicationTarget(null);
      const next = {
        ...draftRef.current,
        contentVersion: result.contentVersion,
        status: result.publicationState,
        canDelete:
          draftRef.current.canDelete && result.publicationState === "draft",
        latestVideoDeletion:
          input.deleteVideoId &&
          draftRef.current.latestVideoDeletion?.videoId === input.deleteVideoId
            ? {
                ...draftRef.current.latestVideoDeletion,
                state: "deletion_requested" as const,
              }
            : draftRef.current.latestVideoDeletion,
        deleteVideoId:
          draftRef.current.deleteVideoId === snapshot.deleteVideoId
            ? null
            : draftRef.current.deleteVideoId,
      };
      draftRef.current = next;
      setDraft(next);
      return "saved";
    },
  });
  const pending = autosave.pending;
  const saved = materialResult?.kind === "saved" ? materialResult : null;
  const presentation: MaterialAuthoringPresentation = {
    ...initialPresentation,
    authorization:
      materialResult?.kind === "unauthorized" ||
      materialResult?.kind === "forbidden"
        ? { kind: "unauthorized" }
        : initialPresentation.authorization,
    blocking:
      materialResult?.kind === "infrastructure_error" ||
      materialResult?.kind === "unexpected_error"
        ? {
            correlationId: materialResult.reference,
            kind: "infrastructure_error",
          }
        : materialResult?.kind === "conflict"
          ? {
              currentContentVersion: materialResult.currentContentVersion,
              kind: "conflict",
              staleContentVersion: materialResult.staleContentVersion,
            }
          : materialResult?.kind === "not_found"
            ? { kind: "not_found" }
            : autosave.error
              ? { kind: "infrastructure_error", correlationId: initialPresentation.submissionId }
              : { kind: "none" },
    deletion: { pending: deletionPending, result: deletionResult },
    draft: effectiveDraft,
    mode: "editor",
    noticeRevision,
    preview: null,
    save: pending
      ? { kind: "submitting" }
      : autosave.dirty || autosave.error
        ? { kind: "dirty" }
        : materialResult?.kind === "saved" || materialResult?.kind === "created"
          ? { kind: "saved", savedAtLabel: "сейчас" }
          : { kind: "clean" },
    submissionId: saved?.nextSubmissionId ?? initialPresentation.submissionId,
    validation: pending
      ? { kind: "checking" }
      : materialResult?.kind === "invalid_input"
        ? { issues: materialResult.issues, kind: "invalid", scope: "input" }
        : { kind: "idle" },
  };

  const markDirty = (nextDraft: MaterialAuthoringPresentation["draft"]) => {
    setDraft(nextDraft);
    draftRef.current = nextDraft;
  };

  const actions = {
    onBack: () => {
      void flushPendingEdits().then((ok) => {
        if (ok) router.push(returnHref);
      });
    },
    onConflictAction: (action) => {
      const materialId = effectiveDraft.materialId;
      if (materialId === null) return;
      if (action === "open_current") {
        window.open(
          withAuthoringReturnHref(
            `/authoring/materials/${materialId}`,
            returnHref,
          ),
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }
      if (action === "compare") {
        window.open(
          withAuthoringReturnHref(
            `/authoring/materials/${materialId}/preview`,
            returnHref,
          ),
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }
      void navigator.clipboard.writeText(
        JSON.stringify(effectiveDraft, null, 2),
      );
    },
    onDocumentChange: (document: JSONContent) => {
      if (
        JSON.stringify(document) === JSON.stringify(effectiveDraft.document)
      ) {
        return;
      }
      markDirty({ ...effectiveDraft, document });
    },
    onFieldChange: (field: MaterialDraftField, value: string) => {
      if (field === "access") {
        markDirty({
          ...effectiveDraft,
          access: value === "membership" ? "membership" : "free",
          deleteVideoId: null,
          primaryVideo:
            value === effectiveDraft.access
              ? effectiveDraft.primaryVideo
              : null,
          primaryVideoId:
            value === effectiveDraft.access
              ? effectiveDraft.primaryVideoId
              : null,
        });
        return;
      }
      markDirty({ ...effectiveDraft, [field]: value });
    },
    onDelete: (input) => {
      deletionMutation.mutate(input);
    },
    onOpenPreview: () => {
      void flushPendingEdits().then((ok) => {
        const id = draftRef.current.materialId;
        if (ok && id !== null)
          router.push(
            withAuthoringReturnHref(
              `/authoring/materials/${id}/preview`,
              returnHref,
            ),
          );
      });
    },
    onPrimaryVideoChange: (primaryVideo, deleteVideoId) => {
      const deletionCandidate =
        deleteVideoId !== null &&
        draftRef.current.primaryVideo?.videoId === deleteVideoId
          ? draftRef.current.primaryVideo
          : draftRef.current.latestVideoDeletion;
      markDirty({
        ...draftRef.current,
        deleteVideoId,
        latestVideoDeletion: deletionCandidate,
        primaryVideo,
        primaryVideoId: primaryVideo?.videoId ?? null,
      });
    },
    onRetry: () => {
      setNoticeRevision((n) => n + 1);
      void autosave.retry();
    },
    onReturnToEditor: () => {
      router.push(
        withAuthoringReturnHref(
          effectiveDraft.materialId === null
            ? "/authoring/materials/new"
            : `/authoring/materials/${effectiveDraft.materialId}`,
          returnHref,
        ),
      );
    },
    onSave: (publicationState) => {
      setPublicationTarget(publicationState);
      setNoticeRevision((n) => n + 1);
    },
    onTagToggle: (tagId: string, checked: boolean) => {
      markDirty({
        ...effectiveDraft,
        tagIds: checked
          ? [...effectiveDraft.tagIds, tagId]
          : effectiveDraft.tagIds.filter((candidate) => candidate !== tagId),
      });
    },
    onSeriesToggle: (seriesId: string, checked: boolean) => {
      markDirty({
        ...effectiveDraft,
        seriesIds: checked
          ? [...effectiveDraft.seriesIds, seriesId]
          : effectiveDraft.seriesIds.filter(
              (candidate) => candidate !== seriesId,
            ),
      });
    },
  } satisfies MaterialAuthoringActions;

  return (
    <MaterialAuthoringWorkspace actions={actions} presentation={presentation} />
  );
}
