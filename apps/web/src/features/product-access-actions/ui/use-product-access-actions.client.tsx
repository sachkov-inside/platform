"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  announceEnrollmentChange,
  issueProductAccessOperation,
  previewProductRevocation,
  restoreProductAccessOperation,
  revokeProductAccess,
  type BillingFailureCode,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { ReasonDialog } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  accessFailureMessage,
  grantOutcomeMessage,
  isStaleAccess,
  restoredMessage,
  revokedMessage,
} from "../model/access-outcomes";
import {
  encodeAccessReason,
  otherReason,
  reasonNoteMaxCharacters,
  revokeReasons,
} from "../model/access-reasons";
import { revocationConsequence } from "../model/revocation-consequence";
import { useAccessProductCatalog } from "../model/use-access-product-catalog.client";
import {
  GrantProductDialog,
  type HeldAccess,
} from "./grant-product-dialog.client";
import { RestoreAccessDialog } from "./restore-access-dialog.client";

/** Продукт человека, как его показывает карточка: от ревизии зависит, устарела ли она. */
export interface AccessCardProduct {
  readonly productId: string;
  readonly name: string;
  readonly access: HeldAccess;
  readonly revision: number;
}

export interface ProductAccessActionsInput {
  readonly accountId: string;
  /** Подпись человека из шапки: «Анна Петрова». */
  readonly personTitle: string;
  /** Продукты по карточке; `null`, если блок продуктов не прочитался. */
  readonly products: readonly AccessCardProduct[] | null;
  /** Сервер принял запись: страница перечитывает карточку и список людей. */
  readonly onWritten: () => void;
  /** «Обновить данные» после конфликта ревизии: страница перечитывает карточку. */
  readonly onRefresh: () => Promise<unknown>;
}

export interface ProductAccessActions {
  readonly openGrant: () => void;
  readonly revoke: (productId: string) => void;
  readonly restore: (productId: string) => void;
  /** Продукт, для которого сейчас готовится отзыв: его кнопка показывает ожидание. */
  readonly pendingProductId: string | null;
  /** Уведомление над продуктами: успех, отказ или устаревшая карточка. */
  readonly notice: ReactNode;
  /** Окна действий; страница ставит их один раз. */
  readonly overlay: ReactNode;
}

type Notice =
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stale" };

interface RevokeTarget {
  readonly product: AccessCardProduct;
  readonly revision: number;
  readonly community: "closes" | "remains";
}

/**
 * Выдача, отзыв и восстановление доступа в карточке человека (#1721). Каждое действие вызывает
 * Product Access и показывает его ответ, ничего не решая само:
 *
 * - выдача несёт `sourceRef`, созданный при открытии окна, поэтому повтор той же попытки не
 *   выдаёт продукт второй раз;
 * - отзыв сначала спрашивает предпросмотр: если ревизия уже не та, что в карточке, окно не
 *   открывается, а карточка предлагает обновить данные; иначе отзыв отправляется с ревизией
 *   предпросмотра;
 * - восстановление отправляется с ревизией карточки сразу после причины;
 * - `revision_conflict` ничего не меняет и показывает «Обновить данные»; `operation_conflict`
 *   получает новый идентификатор операции и просит повторить.
 */
export function useProductAccessActions({
  accountId,
  onRefresh,
  onWritten,
  personTitle,
  products,
}: ProductAccessActionsInput): ProductAccessActions {
  const catalog = useAccessProductCatalog();
  const operations = useRepeatableOperations();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [grant, setGrant] = useState<{ readonly sourceRef: string } | null>(
    null,
  );
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<AccessCardProduct | null>(
    null,
  );

  const held: ReadonlyMap<string, HeldAccess> | null =
    products === null
      ? null
      : new Map(products.map((product) => [product.productId, product.access]));
  const find = (productId: string) =>
    products?.find((product) => product.productId === productId);

  const written = (message: string) => {
    setNotice({ kind: "done", message });
    announceEnrollmentChange();
    onWritten();
  };
  /** Отказ внутри окна; устаревшая карточка закрывает окно и говорит над продуктами. */
  const refused = (code: BillingFailureCode, close: () => void) => {
    if (isStaleAccess(code)) {
      close();
      setNotice({ kind: "stale" });
      return;
    }
    setDialogError(accessFailureMessage(code));
  };

  const issue = useMutation({
    mutationFn: issueProductAccessOperation.send,
    retry: false,
  });
  const preview = useMutation({
    mutationFn: previewProductRevocation,
    retry: false,
  });
  const revocation = useMutation({
    mutationFn: revokeProductAccess,
    retry: false,
  });
  const restoration = useMutation({
    mutationFn: restoreProductAccessOperation.send,
    retry: false,
  });

  const openGrant = () => {
    setNotice(null);
    setDialogError(null);
    issue.reset();
    setGrant({ sourceRef: crypto.randomUUID() });
  };

  const revoke = (productId: string) => {
    const product = find(productId);
    if (product === undefined || preview.isPending) return;
    setNotice(null);
    setDialogError(null);
    preview.mutate(
      { accountId, productId },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            setNotice(
              isStaleAccess(result.code)
                ? { kind: "stale" }
                : {
                    kind: "failed",
                    message: accessFailureMessage(result.code),
                  },
            );
            return;
          }
          const value = result.value.value;
          // Доступ изменился после загрузки карточки: отзывать то, чего владелец не видит, нельзя.
          if (value.revision !== product.revision) {
            setNotice({ kind: "stale" });
            return;
          }
          setRevokeTarget({
            community: value.community,
            product,
            revision: value.revision,
          });
        },
      },
    );
  };

  const restore = (productId: string) => {
    const product = find(productId);
    if (product === undefined) return;
    setNotice(null);
    setDialogError(null);
    restoration.reset();
    setRestoreTarget(product);
  };

  const overlay = (
    <>
      <GrantProductDialog
        catalog={catalog}
        error={dialogError}
        held={held}
        onConfirm={({ product, reason }) => {
          if (grant === null) return;
          setDialogError(null);
          const sourceRef = grant.sourceRef;
          issue.mutate(
            {
              accountId,
              productId: product.productId,
              reason,
              sourceRef,
            },
            {
              onSuccess: (result) => {
                if (!result.ok) {
                  // Та же попытка с другим продуктом: следующая получает свой `sourceRef`.
                  if (result.code === "operation_conflict")
                    setGrant({ sourceRef: crypto.randomUUID() });
                  refused(result.code, () => {
                    setGrant(null);
                  });
                  return;
                }
                setGrant(null);
                written(
                  grantOutcomeMessage(result.value.outcome, product.name),
                );
              },
            },
          );
        }}
        onOpenChange={(open) => {
          if (!open) setGrant(null);
        }}
        onRestoreInstead={(productId) => {
          setGrant(null);
          restore(productId);
        }}
        open={grant !== null}
        pending={issue.isPending}
        personTitle={personTitle}
      />
      <ReasonDialog
        confirmLabel="Отозвать доступ"
        {...(revokeTarget === null
          ? {}
          : {
              consequence: (
                <ul className="grid list-disc gap-1 ps-5">
                  {revocationConsequence(revokeTarget.community).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ),
            })}
        error={dialogError}
        noteLabel="Заметка"
        noteMaxLength={reasonNoteMaxCharacters(revokeReasons)}
        onConfirm={(input) => {
          if (revokeTarget === null) return;
          const reason = encodeAccessReason(revokeReasons, input);
          if (!reason.ok) return;
          setDialogError(null);
          const command = {
            accountId,
            expectedRevision: revokeTarget.revision,
            productId: revokeTarget.product.productId,
            reason: reason.text,
          };
          const slot = `revoke:${command.productId}`;
          revocation.mutate(
            { ...command, operationId: operations.operationId(slot, command) },
            {
              onSuccess: (result) => {
                if (!result.ok) {
                  if (
                    result.code === "operation_conflict" ||
                    isStaleAccess(result.code)
                  )
                    operations.completeOperation(slot);
                  refused(result.code, () => {
                    setRevokeTarget(null);
                  });
                  return;
                }
                operations.completeOperation(slot);
                setRevokeTarget(null);
                written(revokedMessage(revokeTarget.product.name));
              },
            },
          );
        }}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        open={revokeTarget !== null}
        otherValue={otherReason}
        pending={revocation.isPending}
        reasons={revokeReasons}
        title={
          revokeTarget === null
            ? "Отозвать доступ"
            : `Отозвать доступ к «${revokeTarget.product.name}»?`
        }
        tone="danger"
      />
      <RestoreAccessDialog
        error={dialogError}
        onConfirm={(reason) => {
          if (restoreTarget === null) return;
          setDialogError(null);
          const command = {
            accountId,
            expectedRevision: restoreTarget.revision,
            productId: restoreTarget.productId,
            reason,
          };
          const slot = `restore:${command.productId}`;
          restoration.mutate(
            { ...command, operationId: operations.operationId(slot, command) },
            {
              onSuccess: (result) => {
                if (!result.ok) {
                  if (
                    result.code === "operation_conflict" ||
                    isStaleAccess(result.code)
                  )
                    operations.completeOperation(slot);
                  refused(result.code, () => {
                    setRestoreTarget(null);
                  });
                  return;
                }
                operations.completeOperation(slot);
                setRestoreTarget(null);
                written(restoredMessage(restoreTarget.name));
              },
            },
          );
        }}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        open={restoreTarget !== null}
        pending={restoration.isPending}
        productName={restoreTarget?.name ?? ""}
      />
    </>
  );

  return {
    notice: (
      <AccessNotice
        notice={notice}
        onRefresh={() => {
          void onRefresh().then(() => {
            setNotice(null);
          });
        }}
      />
    ),
    openGrant,
    overlay,
    pendingProductId: preview.isPending ? preview.variables.productId : null,
    restore,
    revoke,
  };
}

/**
 * Уведомление о последнем действии. Область `status` стоит всегда, чтобы экранный диктор
 * прочитал подтверждение, появившееся в ней; отказ и устаревшая карточка приходят как `alert`.
 */
function AccessNotice({
  notice,
  onRefresh,
}: {
  readonly notice: Notice | null;
  readonly onRefresh: () => void;
}) {
  return (
    <>
      <div role="status">
        {notice?.kind === "done" ? (
          <p className="flex gap-2 rounded-xl border border-border bg-secondary p-3 text-sm">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            {notice.message}
          </p>
        ) : null}
      </div>
      {notice?.kind === "failed" ? (
        <p
          className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm"
          role="alert"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {notice.message}
        </p>
      ) : null}
      {notice?.kind === "stale" ? (
        <div
          className="grid gap-3 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm sm:flex sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="flex gap-2">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            Доступ изменился, пока была открыта карточка. Действие не выполнено:
            обновите данные и посмотрите, что сейчас.
          </p>
          <Button
            className="min-h-11 shrink-0 px-4"
            onClick={onRefresh}
            type="button"
            variant="outline"
          >
            Обновить данные
          </Button>
        </div>
      ) : null}
    </>
  );
}
