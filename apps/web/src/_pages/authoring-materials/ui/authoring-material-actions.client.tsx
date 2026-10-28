"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  deleteMaterialDraft,
  MaterialDeleteDialog,
  transitionMaterialPublication,
  type TransitionMaterialPublicationResult,
} from "@/features/material-lifecycle";
import type { AdminRowMenuItem } from "@/shared/ui/admin";

import type { AuthoringMaterialListItem } from "../model/authoring-materials-presentation";
import {
  withPublicationReceipt,
  type MaterialPublicationReceipt,
} from "../model/authoring-materials-query";
import { authoringMaterialsQueryKey } from "../model/authoring-materials-query-options";

/** A row with the addresses its actions lead to. */
export interface AuthoringMaterialRow {
  readonly editorHref: Route;
  readonly item: AuthoringMaterialListItem;
  readonly previewHref: Route;
  readonly title: string;
}

type Notice =
  | {
      readonly kind: "publication";
      readonly editorHref: Route;
      readonly result: TransitionMaterialPublicationResult;
      readonly title: string;
    }
  | { readonly kind: "deleted"; readonly title: string };

/**
 * The lifecycle commands of the Materials list. The table renders each row twice (a desktop table
 * and a phone list), so the commands, their results and the deletion dialog live once per page:
 * a row menu only names its Material.
 *
 * After a saved publication change the row shows the receipt until the list re-read brings that
 * version, and the next command of that row sends the receipt's version and submission key.
 */
export function useAuthoringMaterialLifecycle() {
  const queryClient = useQueryClient();
  const refreshMaterials = () =>
    queryClient.invalidateQueries({ queryKey: authoringMaterialsQueryKey() });
  const [receipts, setReceipts] = useState<
    ReadonlyMap<string, MaterialPublicationReceipt>
  >(() => new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deletionTarget, setDeletionTarget] =
    useState<AuthoringMaterialRow | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);

  const publication = useMutation({
    mutationFn: transitionMaterialPublication,
    onSuccess: (result, input) => {
      if (result.kind !== "saved") return;
      setReceipts((current) =>
        new Map(current).set(input.materialId, {
          contentVersion: result.contentVersion,
          publicationState: result.publicationState,
          submissionId: result.nextSubmissionId,
        }),
      );
      void refreshMaterials();
    },
  });
  const deletion = useMutation({
    mutationFn: deleteMaterialDraft,
    onSuccess: (result) => {
      if (result.kind === "deleted") void refreshMaterials();
    },
  });
  const pendingMaterialId = publication.isPending
    ? publication.variables.materialId
    : deletion.isPending
      ? deletion.variables.materialId
      : null;

  const togglePublication = (row: AuthoringMaterialRow) => {
    setNotice(null);
    publication.mutate(
      {
        expectedContentVersion: row.item.contentVersion,
        materialId: row.item.materialId,
        publicationState:
          row.item.publicationState === "published"
            ? "unpublished"
            : "published",
        submissionId: row.item.submissionId,
      },
      {
        onSuccess: (result) => {
          setNotice({
            editorHref: row.editorHref,
            kind: "publication",
            result,
            title: row.title,
          });
        },
      },
    );
  };

  const menuItems = (row: AuthoringMaterialRow): AdminRowMenuItem[] => {
    const busy = pendingMaterialId === row.item.materialId;
    const items: AdminRowMenuItem[] = [
      { href: row.previewHref, id: "preview", label: "Предпросмотр" },
      {
        disabled: busy,
        id: "publication",
        label:
          row.item.publicationState === "published"
            ? "Снять с публикации"
            : "Опубликовать",
        onSelect: () => {
          togglePublication(row);
        },
      },
    ];
    if (row.item.canDelete && row.item.publicationState === "draft")
      items.push({
        disabled: busy,
        id: "delete",
        label: "Удалить черновик",
        onSelect: () => {
          setNotice(null);
          deletion.reset();
          setDeletionTarget(row);
          setDeletionOpen(true);
        },
        tone: "danger",
      });
    return items;
  };

  const overlay: ReactNode = (
    <>
      <LifecycleStatus notice={notice} />
      {deletionTarget === null ? null : (
        <MaterialDeleteDialog
          contentVersion={deletionTarget.item.contentVersion}
          key={deletionTarget.item.materialId}
          materialId={deletionTarget.item.materialId}
          onDelete={(input) => {
            deletion.mutate(input, {
              onSuccess: (result) => {
                if (result.kind !== "deleted") return;
                setDeletionOpen(false);
                setNotice({ kind: "deleted", title: deletionTarget.title });
              },
            });
          }}
          onOpenChange={setDeletionOpen}
          open={deletionOpen}
          pending={deletion.isPending}
          result={deletion.data ?? null}
          submissionId={deletionTarget.item.submissionId}
          title={deletionTarget.item.title}
        />
      )}
    </>
  );

  return {
    /** The visible state of a row: the server row or a newer publication receipt. */
    current: (item: AuthoringMaterialListItem) =>
      withPublicationReceipt(item, receipts.get(item.materialId)),
    menuItems,
    /** A failed command, shown above the table until the next command. */
    notice: <LifecycleAlert notice={notice} />,
    overlay,
    pending: pendingMaterialId !== null,
  };
}

/** Success is announced, not shown: the row badge already says the new state. */
function LifecycleStatus({ notice }: { readonly notice: Notice | null }) {
  const message =
    notice === null
      ? ""
      : notice.kind === "deleted"
        ? `Черновик «${notice.title}» удалён.`
        : notice.result.kind === "saved"
          ? notice.result.publicationState === "published"
            ? `Материал «${notice.title}» опубликован.`
            : `Материал «${notice.title}» снят с публикации.`
          : "";
  return (
    <p className="sr-only" role="status">
      {message}
    </p>
  );
}

function LifecycleAlert({ notice }: { readonly notice: Notice | null }) {
  if (notice?.kind !== "publication" || notice.result.kind === "saved")
    return null;
  const { result } = notice;
  const removalNeedsEditor =
    result.kind === "conflict" &&
    result.reason === "product_removal_confirmation_required";
  const message =
    result.kind === "unauthorized"
      ? "Сессия завершилась. Войдите снова."
      : result.kind === "forbidden"
        ? "У аккаунта больше нет права управлять материалами."
        : result.kind === "not_found"
          ? "Материал больше не найден. Обновите список."
          : removalNeedsEditor
            ? "Материал входит в купленный продукт. Снять его можно в редакторе, подтвердив снятие."
            : result.kind === "conflict"
              ? "Материал изменился в другой сессии. Обновите список."
              : result.kind === "invalid_input"
                ? "Материал пока нельзя опубликовать."
                : result.kind === "infrastructure_error"
                  ? `Действие временно недоступно. Код: ${result.reference}`
                  : `Не удалось проверить результат. Код: ${result.reference}`;
  return (
    <div
      className="rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm"
      role="alert"
    >
      <p>
        <span className="font-semibold">«{notice.title}».</span> {message}
      </p>
      {result.kind === "invalid_input" || removalNeedsEditor ? (
        <Link
          className="mt-2 inline-block font-semibold underline underline-offset-4"
          href={notice.editorHref}
        >
          {removalNeedsEditor ? "Открыть в редакторе" : "Исправить в редакторе"}
        </Link>
      ) : null}
    </div>
  );
}
