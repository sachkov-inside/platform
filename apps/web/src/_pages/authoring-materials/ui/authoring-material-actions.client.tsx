"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  deleteMaterialDraft,
  MaterialDeleteDialog,
  MaterialPublicationActionButton,
  transitionMaterialPublication,
  type TransitionMaterialPublicationResult,
} from "@/features/material-lifecycle";

import type { AuthoringMaterialListItem } from "../model/authoring-materials-presentation";
import { authoringMaterialsQueryKey } from "../model/authoring-materials-query-options";

export function AuthoringMaterialActions({
  editorHref,
  material,
}: {
  readonly editorHref: Route;
  readonly material: AuthoringMaterialListItem;
}) {
  const queryClient = useQueryClient();
  const refreshMaterials = () =>
    queryClient.invalidateQueries({ queryKey: authoringMaterialsQueryKey() });
  const publicationMutation = useMutation({
    mutationFn: transitionMaterialPublication,
    onSuccess: (result) => {
      if (result.kind === "saved") void refreshMaterials();
    },
  });
  const deletionMutation = useMutation({
    mutationFn: deleteMaterialDraft,
    onSuccess: (result) => {
      if (result.kind === "deleted") void refreshMaterials();
    },
  });
  const publicationResult = publicationMutation.data ?? null;
  const deletionResult = deletionMutation.data ?? null;
  const publicationPending = publicationMutation.isPending;
  const deletionPending = deletionMutation.isPending;
  const publicationStatus =
    publicationResult?.kind === "saved"
      ? publicationResult.publicationState
      : material.publicationState;
  const contentVersion =
    publicationResult?.kind === "saved"
      ? publicationResult.contentVersion
      : material.contentVersion;
  const publicationState =
    publicationStatus === "published" ? "unpublished" : "published";
  const operation = publicationState === "published" ? "publish" : "unpublish";
  const submissionId =
    publicationResult?.kind === "saved"
      ? publicationResult.nextSubmissionId
      : material.submissionId;

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          publicationMutation.mutate({
            expectedContentVersion: contentVersion,
            materialId: material.materialId,
            publicationState,
            submissionId,
          });
        }}
      >
        <MaterialPublicationActionButton
          className="min-h-11 w-full"
          disabled={publicationPending || deletionPending}
          operation={operation}
          pending={publicationPending}
          type="submit"
          variant="outline"
        />
      </form>
      {material.canDelete && publicationResult?.kind !== "saved" ? (
        <MaterialDeleteDialog
          contentVersion={contentVersion}
          materialId={material.materialId}
          onDelete={deletionMutation.mutate}
          pending={deletionPending}
          result={deletionResult}
          submissionId={material.submissionId}
          title={material.title}
        />
      ) : null}
      <PublicationNotice editorHref={editorHref} result={publicationResult} />
    </>
  );
}

function PublicationNotice({
  editorHref,
  result,
}: {
  readonly editorHref: Route;
  readonly result: TransitionMaterialPublicationResult | null;
}) {
  if (result === null) return null;
  if (result.kind === "saved") {
    return (
      <span className="sr-only" role="status">
        {result.publicationState === "published"
          ? "Материал опубликован."
          : "Материал снят с публикации."}
      </span>
    );
  }
  const message =
    result.kind === "unauthorized"
      ? "Сессия завершилась. Войдите снова."
      : result.kind === "forbidden"
        ? "У аккаунта больше нет права управлять материалами."
        : result.kind === "not_found"
          ? "Материал больше не найден. Обновите список."
          : result.kind === "conflict"
            ? "Материал изменился в другой сессии. Обновите список."
            : result.kind === "invalid_input"
              ? "Материал пока нельзя опубликовать."
              : result.kind === "infrastructure_error"
                ? `Действие временно недоступно. Код: ${result.reference}`
                : `Не удалось проверить результат. Код: ${result.reference}`;
  return (
    <div
      className="col-span-2 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm sm:basis-full"
      role="alert"
    >
      <p>{message}</p>
      {result.kind === "invalid_input" ? (
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
