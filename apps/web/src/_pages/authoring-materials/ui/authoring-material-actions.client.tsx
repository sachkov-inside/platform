"use client";

import type { Route } from "next";
import Link from "next/link";
import { startTransition, useActionState } from "react";

import {
  initialMaterialLifecycleActionState,
  MaterialDeleteDialog,
  MaterialPublicationActionButton,
  type MaterialLifecycleActionState,
} from "@/features/material-authoring";

import type { AuthoringMaterialListItem } from "../model/authoring-materials-presentation";

export type MaterialLifecycleMutationAction = (
  state: MaterialLifecycleActionState,
  formData: FormData,
) => Promise<MaterialLifecycleActionState>;

export function AuthoringMaterialActions({
  editorHref,
  lifecycleAction,
  material,
}: {
  readonly editorHref: Route;
  readonly lifecycleAction: MaterialLifecycleMutationAction;
  readonly material: AuthoringMaterialListItem;
}) {
  const [publicationState, publicationAction, publicationPending] =
    useActionState(lifecycleAction, initialMaterialLifecycleActionState);
  const [deletionState, deletionAction, deletionPending] = useActionState(
    lifecycleAction,
    initialMaterialLifecycleActionState,
  );
  const operation =
    material.publicationState === "published" ? "unpublish" : "publish";
  const submissionId =
    publicationState.kind === "saved"
      ? publicationState.nextSubmissionId
      : material.submissionId;

  return (
    <>
      <form action={publicationAction}>
        <input
          name="expectedContentVersion"
          type="hidden"
          value={material.contentVersion}
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
      {material.canDelete ? (
        <MaterialDeleteDialog
          contentVersion={material.contentVersion}
          materialId={material.materialId}
          onDelete={(formData) => {
            startTransition(() => {
              deletionAction(formData);
            });
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
