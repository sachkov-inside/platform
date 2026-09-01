"use client";

import type { JSONContent } from "@tiptap/core";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
} from "@/widgets/material-authoring/editor";
import { deleteMaterialDraft } from "@/features/material-lifecycle";
import { withAuthoringReturnHref } from "@/shared/routing/authoring";

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
  const creating = initialPresentation.draft.status === "new";
  const materialResult = creating ? createMutation.data : saveMutation.data;
  const pending = creating ? createMutation.isPending : saveMutation.isPending;
  const [draft, setDraft] = useState(initialPresentation.draft);
  const [dirty, setDirty] = useState(false);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const retryCreateInput = useRef<CreateMaterialDraftInput | null>(null);
  const retrySaveInput = useRef<SaveMaterialInput | null>(null);
  const deletionResult = deletionMutation.data ?? null;
  const deletionPending = deletionMutation.isPending;

  const failedMutation =
    materialResult?.kind === "conflict" ||
    materialResult?.kind === "infrastructure_error" ||
    materialResult?.kind === "invalid_input" ||
    materialResult?.kind === "not_found" ||
    materialResult?.kind === "unexpected_error";

  const created = materialResult?.kind === "created" ? materialResult.draft : null;
  const saved = materialResult?.kind === "saved" ? materialResult : null;
  const persistedDraft =
    saved !== null
        ? {
            ...draft,
            canDelete:
              draft.canDelete && saved.publicationState === "draft",
            contentVersion: saved.contentVersion,
            status: saved.publicationState,
          }
        : draft;
  const persistedDraftIsNewer =
    (created !== null &&
      (draft.materialId !== created.materialId ||
        draft.contentVersion !== created.contentVersion)) ||
    (saved !== null && draft.contentVersion !== saved.contentVersion);
  const effectiveDraft =
    pending || failedMutation || !persistedDraftIsNewer ? draft : persistedDraft;

  useEffect(() => {
    if (created !== null) {
      window.location.replace(
        withAuthoringReturnHref(
          `/authoring/materials/${created.materialId}`,
          returnHref,
        ),
      );
    }
  }, [created, returnHref]);

  const presentation: MaterialAuthoringPresentation = {
    ...initialPresentation,
    authorization:
      materialResult?.kind === "unauthorized" || materialResult?.kind === "forbidden"
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
            : { kind: "none" },
    deletion: { pending: deletionPending, result: deletionResult },
    draft: effectiveDraft,
    mode: "editor",
    noticeRevision,
    preview: null,
    save: pending
      ? { kind: "submitting" }
      : failedMutation || (dirty && !persistedDraftIsNewer)
          ? { kind: "dirty" }
          : created !== null || saved !== null
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
    setDirty(true);
  };

  const actions = {
    onBack: () => {
      router.push(returnHref);
    },
    onConflictAction: (action) => {
      const materialId = effectiveDraft.materialId;
      if (materialId === null) return;
      if (action === "open_current") {
        window.open(
          withAuthoringReturnHref(`/authoring/materials/${materialId}`, returnHref),
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
      void navigator.clipboard.writeText(JSON.stringify(effectiveDraft, null, 2));
    },
    onDocumentChange: (document: JSONContent) => {
      if (JSON.stringify(document) === JSON.stringify(effectiveDraft.document)) {
        return;
      }
      markDirty({ ...effectiveDraft, document });
    },
    onFieldChange: (field: MaterialDraftField, value: string) => {
      if (field === "access") {
        markDirty({
          ...effectiveDraft,
          access: value === "membership" ? "membership" : "free",
        });
        return;
      }
      markDirty({ ...effectiveDraft, [field]: value });
    },
    onDelete: (input) => {
      deletionMutation.mutate(input);
    },
    onOpenPreview: () => {
      if (effectiveDraft.materialId !== null) {
        router.push(
          withAuthoringReturnHref(
            `/authoring/materials/${effectiveDraft.materialId}/preview`,
            returnHref,
          ),
        );
      }
    },
    onRetry: () => {
      if (creating && retryCreateInput.current !== null) {
        setDirty(false);
        setNoticeRevision((current) => current + 1);
        createMutation.mutate(retryCreateInput.current);
        return;
      }
      if (!creating && retrySaveInput.current !== null) {
        setDirty(false);
        setNoticeRevision((current) => current + 1);
        saveMutation.mutate(retrySaveInput.current);
      }
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
      setDirty(false);
      setNoticeRevision((current) => current + 1);
      if (creating) {
        const input: CreateMaterialDraftInput = {
          access: effectiveDraft.access,
          document: effectiveDraft.document,
          formatId: effectiveDraft.formatId,
          seriesIds: effectiveDraft.seriesIds,
          submissionId: presentation.submissionId,
          summary: effectiveDraft.summary,
          tagIds: effectiveDraft.tagIds,
          title: effectiveDraft.title,
          topicId: effectiveDraft.topicId,
        };
        retryCreateInput.current = input;
        createMutation.mutate(input);
        return;
      }
      if (
        effectiveDraft.materialId === null ||
        effectiveDraft.contentVersion === null
      ) {
        return;
      }
      const input: SaveMaterialInput = {
        access: effectiveDraft.access,
        document: effectiveDraft.document,
        expectedContentVersion: effectiveDraft.contentVersion,
        formatId: effectiveDraft.formatId,
        materialId: effectiveDraft.materialId,
        publicationState,
        seriesIds: effectiveDraft.seriesIds,
        submissionId: presentation.submissionId,
        summary: effectiveDraft.summary,
        tagIds: effectiveDraft.tagIds,
        title: effectiveDraft.title,
        topicId: effectiveDraft.topicId,
      };
      retrySaveInput.current = input;
      saveMutation.mutate(input);
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
          : effectiveDraft.seriesIds.filter((candidate) => candidate !== seriesId),
      });
    },
  } satisfies MaterialAuthoringActions;

  return <MaterialAuthoringWorkspace actions={actions} presentation={presentation} />;
}
