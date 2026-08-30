"use client";

import type { JSONContent } from "@tiptap/core";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
  initialMaterialLifecycleActionState,
  type MaterialLifecycleActionState,
  withAuthoringReturnHref,
} from "@/features/material-authoring";

import {
  initialMaterialAuthoringActionState,
  type MaterialAuthoringActionState,
} from "../model/material-authoring-action-state";

type MaterialMutationAction = (
  state: MaterialAuthoringActionState,
  formData: FormData,
) => Promise<MaterialAuthoringActionState>;

type MaterialLifecycleMutationAction = (
  state: MaterialLifecycleActionState,
  formData: FormData,
) => Promise<MaterialLifecycleActionState>;

interface MaterialAuthoringPageClientProps {
  readonly initialPresentation: MaterialAuthoringPresentation;
  readonly lifecycleAction: MaterialLifecycleMutationAction;
  readonly mutationAction: MaterialMutationAction;
  readonly returnHref: Route;
}

export function MaterialAuthoringPageClient({
  initialPresentation,
  lifecycleAction,
  mutationAction,
  returnHref,
}: MaterialAuthoringPageClientProps) {
  const router = useRouter();
  const [actionState, dispatch, pending] = useActionState(
    mutationAction,
    initialMaterialAuthoringActionState,
  );
  const [draft, setDraft] = useState(initialPresentation.draft);
  const [dirty, setDirty] = useState(false);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const retryData = useRef<FormData | null>(null);
  const acceptDelete = useCallback(
    async (state: MaterialLifecycleActionState, formData: FormData) => {
      const result = await lifecycleAction(state, formData);
      if (result.kind === "deleted") {
        router.replace(returnHref);
      }
      return result;
    },
    [lifecycleAction, returnHref, router],
  );
  const [deletionState, deleteAction, deletionPending] = useActionState(
    acceptDelete,
    initialMaterialLifecycleActionState,
  );

  const failedMutation =
    actionState.kind === "conflict" ||
    actionState.kind === "infrastructure_error" ||
    actionState.kind === "invalid_input" ||
    actionState.kind === "not_found" ||
    actionState.kind === "unexpected_error";

  const created = actionState.kind === "created" ? actionState.draft : null;
  const saved = actionState.kind === "saved" ? actionState : null;
  const persistedDraft =
    created !== null
      ? {
          ...draft,
          canDelete: true,
          access: created.access,
          contentVersion: created.contentVersion,
          document: created.document,
          formatId: created.formatId ?? "unassigned",
          materialId: created.materialId,
          readOnly: false,
          seriesIds: created.seriesIds,
          status: "draft" as const,
          summary: created.summary,
          tagIds: created.tagIds,
          title: created.title,
          topicId: created.topicId ?? "unassigned",
        }
      : saved !== null
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
    preview: created?.preview ?? null,
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
      : (created?.validation ??
        saved?.validation ??
        (actionState.kind === "invalid_input"
          ? { issues: actionState.issues, kind: "invalid", scope: "input" }
          : { kind: "idle" })),
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
      startTransition(() => {
        deleteAction(formData);
      });
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
        startTransition(() => {
          dispatch(retryData.current ?? new FormData());
        });
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
      retryData.current = copyFormData(formData);
      setDirty(false);
      setNoticeRevision((current) => current + 1);
      startTransition(() => {
        dispatch(formData);
      });
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
