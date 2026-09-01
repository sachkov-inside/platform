"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import {
  initialMaterialLifecycleActionState,
  MaterialDeleteDialog,
  MaterialPublicationActionButton,
  type MaterialLifecycleActionState,
  mutateMaterialLifecycle,
} from "@/features/material-lifecycle";

import type { AuthoringMaterialListItem } from "../model/authoring-materials-presentation";

export function AuthoringMaterialActions({
  editorHref,
  material,
}: {
  readonly editorHref: Route;
  readonly material: AuthoringMaterialListItem;
}) {
  const router = useRouter();
  const publicationMutation = useMutation({
    mutationFn: mutateMaterialLifecycle,
    onSuccess: (result) => {
      if (result.kind === "saved") router.refresh();
    },
  });
  const deletionMutation = useMutation({
    mutationFn: mutateMaterialLifecycle,
    onSuccess: (result) => {
      if (result.kind === "deleted") router.refresh();
    },
  });
  const publicationState = publicationMutation.data ?? initialMaterialLifecycleActionState;
  const deletionState = deletionMutation.data ?? initialMaterialLifecycleActionState;
  const publicationPending = publicationMutation.isPending;
  const deletionPending = deletionMutation.isPending;
  const publicationStatus =
    publicationState.kind === "saved"
      ? publicationState.publicationState
      : material.publicationState;
  const contentVersion =
    publicationState.kind === "saved"
      ? publicationState.contentVersion
      : material.contentVersion;
  const operation = publicationStatus === "published" ? "unpublish" : "publish";
  const submissionId =
    publicationState.kind === "saved"
      ? publicationState.nextSubmissionId
      : material.submissionId;

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          publicationMutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <input
          name="expectedContentVersion"
          type="hidden"
          value={contentVersion}
        />
        <input name="materialId" type="hidden" value={material.materialId} />
        <input name="operation" type="hidden" value={operation} />
        <input name="submissionId" type="hidden" value={submissionId} />
        <MaterialPublicationActionButton
          className="min-h-11 w-full"
          disabled={publicationPending || deletionPending}
          operation={operation}
          pending={publicationPending}
          type="submit"
          variant="outline"
        />
      </form>
      {material.canDelete && publicationState.kind !== "saved" ? (
        <MaterialDeleteDialog
          contentVersion={contentVersion}
          materialId={material.materialId}
          onDelete={(formData) => {
            deletionMutation.mutate(formData);
          }}
          pending={deletionPending}
          state={deletionState}
          submissionId={material.submissionId}
          title={material.title}
        />
      ) : null}
      <PublicationNotice editorHref={editorHref} state={publicationState} />
    </>
  );
}

function PublicationNotice({
  editorHref,
  state,
}: {
  readonly editorHref: Route;
  readonly state: MaterialLifecycleActionState;
}) {
  if (state.kind === "idle" || state.kind === "deleted") return null;
  if (state.kind === "saved") {
    return (
      <p
        className="col-span-2 text-sm font-medium text-foreground sm:basis-full"
        role="status"
      >
        {state.publicationState === "published"
          ? "Материал опубликован."
          : "Материал снят с публикации."}
      </p>
    );
  }
  const message =
    state.kind === "unauthorized"
      ? "Сессия завершилась. Войдите снова."
      : state.kind === "forbidden"
        ? "У аккаунта больше нет права управлять материалами."
        : state.kind === "not_found"
          ? "Материал больше не найден. Обновите список."
          : state.kind === "conflict"
            ? "Материал изменился в другой сессии. Обновите список."
            : state.kind === "invalid_input"
              ? "Материал пока нельзя опубликовать."
              : state.kind === "infrastructure_error"
                ? `Действие временно недоступно. Код: ${state.reference}`
                : `Не удалось проверить результат. Код: ${state.reference}`;
  return (
    <div
      className="col-span-2 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm sm:basis-full"
      role="alert"
    >
      <p>{message}</p>
      {state.kind === "invalid_input" ? (
        <Link
          className="mt-2 inline-block font-semibold underline underline-offset-4"
          href={editorHref}
        >
          Исправить в редакторе
        </Link>
      ) : null}
    </div>
  );
}
