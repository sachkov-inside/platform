"use client";

import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useRef, useState } from "react";

import {
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
} from "@/features/material-authoring";

import {
  initialCreateMaterialDraftState,
  type CreateMaterialDraftActionState,
} from "../model/create-material-draft-state";

type CreateMaterialDraftAction = (
  state: CreateMaterialDraftActionState,
  formData: FormData,
) => Promise<CreateMaterialDraftActionState>;

interface MaterialAuthoringPageClientProps {
  readonly createDraftAction: CreateMaterialDraftAction;
  readonly initialPresentation: MaterialAuthoringPresentation;
}

export function MaterialAuthoringPageClient({
  createDraftAction,
  initialPresentation,
}: MaterialAuthoringPageClientProps) {
  const router = useRouter();
  const [actionState, dispatch, pending] = useActionState(
    createDraftAction,
    initialCreateMaterialDraftState,
  );
  const [draft, setDraft] = useState(initialPresentation.draft);
  const [dirty, setDirty] = useState(false);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const retryData = useRef<FormData | null>(null);

  const created = actionState.kind === "created" ? actionState.draft : null;
  const presentation: MaterialAuthoringPresentation = {
    ...initialPresentation,
    authorization:
      actionState.kind === "unauthorized" || actionState.kind === "forbidden"
        ? { kind: "unauthorized" }
        : initialPresentation.authorization,
    blocking:
      actionState.kind === "unexpected_error"
        ? {
            correlationId: actionState.reference,
            kind: "infrastructure_error",
          }
        : { kind: "none" },
    draft:
      created === null
        ? draft
        : {
            ...draft,
            access: created.access,
            contentVersion: created.contentVersion,
            document: created.document,
            formatId: created.formatId ?? "unassigned",
            materialId: created.materialId,
            readOnly: true,
            status: "draft",
            summary: created.summary,
            tagIds: created.tagIds,
            title: created.title,
            topicId: created.topicId ?? "unassigned",
          },
    mode: "editor",
    noticeRevision,
    preview: created?.preview ?? null,
    save: pending
      ? { kind: "submitting" }
      : created !== null
        ? { kind: "saved", savedAtLabel: "сейчас" }
        : dirty
          ? { kind: "dirty" }
          : { kind: "clean" },
    validation: pending
      ? { kind: "checking" }
      : created?.validation ??
        (actionState.kind === "invalid_input"
          ? { issues: actionState.issues, kind: "invalid", scope: "input" }
          : { kind: "idle" }),
  };

  const markDirty = (nextDraft: MaterialAuthoringPresentation["draft"]) => {
    setDraft(nextDraft);
    setDirty(true);
  };

  const actions = {
    onBack: () => {
      router.push("/library");
    },
    onConflictAction: () => undefined,
    onDocumentChange: (document: JSONContent) => {
      markDirty({ ...draft, document });
    },
    onFieldChange: (field: MaterialDraftField, value: string) => {
      if (field === "access") {
        markDirty({
          ...draft,
          access: value === "membership" ? "membership" : "free",
        });
        return;
      }
      markDirty({ ...draft, [field]: value });
    },
    onOpenPreview: () => {
      if (created !== null) {
        router.push(`/authoring/materials/${created.materialId}/preview`);
      }
    },
    onRetry: () => {
      if (retryData.current !== null) {
        setNoticeRevision((current) => current + 1);
        startTransition(() => {
          dispatch(retryData.current ?? new FormData());
        });
      }
    },
    onReturnToEditor: () => {
      router.push("/authoring/materials/new");
    },
    onSave: (formData: FormData) => {
      retryData.current = copyFormData(formData);
      setNoticeRevision((current) => current + 1);
      startTransition(() => {
        dispatch(formData);
      });
    },
    onTagToggle: (tagId: string, checked: boolean) => {
      markDirty({
        ...draft,
        tagIds: checked
          ? [...draft.tagIds, tagId]
          : draft.tagIds.filter((candidate) => candidate !== tagId),
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
