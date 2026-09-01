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
import {
  mutateMaterialLifecycle,
  type MaterialLifecycleActionState,
} from "@/features/material-lifecycle";
import { withAuthoringReturnHref } from "@/shared/routing/authoring";

import {
  createMaterialDraft,
  saveMaterial,
} from "../api/material-authoring.browser";
import {
  initialMaterialAuthoringActionState,
  type MaterialAuthoringActionState,
} from "../model/material-authoring-action-state";

interface MaterialAuthoringPageClientProps {
  readonly initialPresentation: MaterialAuthoringPresentation;
  readonly returnHref: Route;
}

export function MaterialAuthoringPageClient({
  initialPresentation,
  returnHref,
}: MaterialAuthoringPageClientProps) {
  const router = useRouter();
  const materialMutation = useMutation<MaterialAuthoringActionState, Error, FormData>({
    mutationFn: async (formData) =>
      initialPresentation.draft.status === "new"
        ? await createMaterialDraft(formData)
        : await saveMaterial(formData),
  });
  const deletionMutation = useMutation({
    mutationFn: mutateMaterialLifecycle,
    onSuccess: (result) => {
      if (result.kind === "deleted") router.replace(returnHref);
    },
  });
  const actionState = materialMutation.data ?? initialMaterialAuthoringActionState;
  const pending = materialMutation.isPending;
  const [draft, setDraft] = useState(initialPresentation.draft);
  const [dirty, setDirty] = useState(false);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const retryData = useRef<FormData | null>(null);
  const deletionState: MaterialLifecycleActionState =
    deletionMutation.data ?? { kind: "idle" };
  const deletionPending = deletionMutation.isPending;

  const failedMutation =
    actionState.kind === "conflict" ||
    actionState.kind === "infrastructure_error" ||
    actionState.kind === "invalid_input" ||
    actionState.kind === "not_found" ||
    actionState.kind === "unexpected_error";

  const created = actionState.kind === "created" ? actionState.draft : null;
  const saved = actionState.kind === "saved" ? actionState : null;
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
      actionState.kind === "unauthorized" || actionState.kind === "forbidden"
        ? { kind: "unauthorized" }
        : initialPresentation.authorization,
    blocking:
      actionState.kind === "infrastructure_error" ||
      actionState.kind === "unexpected_error"
        ? {
            correlationId: actionState.reference,
            kind: "infrastructure_error",
          }
        : actionState.kind === "conflict"
          ? {
              currentContentVersion: actionState.currentContentVersion,
              kind: "conflict",
              staleContentVersion: actionState.staleContentVersion,
            }
      : actionState.kind === "not_found"
            ? { kind: "not_found" }
            : { kind: "none" },
    deletion: { pending: deletionPending, state: deletionState },
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
      : actionState.kind === "invalid_input"
          ? { issues: actionState.issues, kind: "invalid", scope: "input" }
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
    onDelete: (formData: FormData) => {
      deletionMutation.mutate(formData);
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
      if (retryData.current !== null) {
        setDirty(false);
        setNoticeRevision((current) => current + 1);
        materialMutation.mutate(retryData.current);
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
    onSave: (formData: FormData) => {
      formData.set("document", JSON.stringify(effectiveDraft.document));
      retryData.current = copyFormData(formData);
      setDirty(false);
      setNoticeRevision((current) => current + 1);
      materialMutation.mutate(formData);
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

function copyFormData(source: FormData): FormData {
  const copy = new FormData();
  source.forEach((value, key) => {
    copy.append(key, value);
  });
  return copy;
}
