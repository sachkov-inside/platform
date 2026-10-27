"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import {
  announceEnrollmentChange,
  subscribeEnrollmentChange,
  billingErrorMessage,
  formatBillingDate,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  listProductAccessOperation,
  readProductAccessOperation,
  issueProductAccessOperation,
  restoreProductAccessOperation,
  type accessPairSchema,
  type listProductAccessSchema,
} from "@/entities/subscription";
import { AdminField, AdminSection, formText } from "./admin-form.client";
import { ProductRevocationPanel } from "./product-revocation-panel.client";

const accessQueryKey = ["authoring", "product-access"] as const;
type ListInput = z.infer<typeof listProductAccessSchema>;
type AccessPair = z.infer<typeof accessPairSchema>;
export function ProductAccessPanel() {
  const [accountId, setAccountId] = useState("");
  const [productId, setProductId] = useState("");
  const [listInput, setListInput] = useState<ListInput | null>(null);
  const [detailPair, setDetailPair] = useState<AccessPair | null>(null);
  const client = useQueryClient();
  useEffect(
    () =>
      subscribeEnrollmentChange(() => {
        void client.invalidateQueries(
          { queryKey: accessQueryKey },
          { cancelRefetch: false },
        );
      }),
    [client],
  );
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations();
  const list = useQuery({
    queryKey: [...accessQueryKey, "list", listInput],
    queryFn: () => {
      if (listInput === null) throw new Error("Missing access list selection");
      return listProductAccessOperation.send(listInput);
    },
    enabled: listInput !== null,
    retry: false,
  });
  const read = useQuery({
    queryKey: [...accessQueryKey, "detail", detailPair],
    queryFn: () => {
      if (detailPair === null)
        throw new Error("Missing access history selection");
      return readProductAccessOperation.send(detailPair);
    },
    enabled: detailPair !== null,
    retry: false,
  });
  const rows = list.data?.ok === true ? list.data.value.value : [];
  const cursor = list.data?.ok === true ? list.data.value.nextCursor : null;
  const detail = read.data?.ok === true ? read.data.value.value : null;
  const readFailure =
    list.data?.ok === false
      ? list.data.code
      : read.data?.ok === false
        ? read.data.code
        : undefined;
  function accessWritten() {
    void client.invalidateQueries(
      { queryKey: accessQueryKey },
      { cancelRefetch: false },
    );
    announceEnrollmentChange();
    setError(undefined);
  }
  const issue = useMutation({
    mutationFn: issueProductAccessOperation.send,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      setNotice(
        result.value.outcome === "revoked"
          ? "Доступ отозван. Для возврата права используйте явное восстановление."
          : "Бессрочное право сохранено.",
      );
      accessWritten();
    },
  });
  const restore = useMutation({
    mutationFn: restoreProductAccessOperation.send,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      repeat.completeOperation("restore");
      setNotice("Доступ явно восстановлен владельцем.");
      accessWritten();
    },
  });
  const busy =
    list.isLoading || read.isLoading || issue.isPending || restore.isPending;
  const lost = list.isError || read.isError || issue.isError || restore.isError;
  function refresh() {
    setError(undefined);
    if (
      listInput !== null &&
      listInput.cursor === undefined &&
      (listInput.accountId ?? "") === accountId &&
      (listInput.productId ?? "") === productId
    ) {
      void list.refetch();
      return;
    }
    setListInput({
      limit: 50,
      ...(accountId.length > 0 ? { accountId } : {}),
      ...(productId.length > 0 ? { productId } : {}),
    });
  }
  return (
    <AdminSection
      title="Доступ к продуктам"
      description="У Account одно бессрочное право на продукт. Возврат денег выполняется в банке отдельно от отзыва. Автоматическая активация не восстанавливает отозванное право."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          label="Account"
          name="accountId"
          disabled={busy}
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setDetailPair(null);
          }}
        />
        <AdminField
          label="Продукт"
          name="productId"
          disabled={busy}
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setDetailPair(null);
          }}
        />
      </div>
      <Button className="min-h-11" disabled={busy} onClick={refresh}>
        Показать права
      </Button>
      {error !== undefined || readFailure !== undefined || lost ? (
        <p role="alert">
          {error ??
            (readFailure === undefined
              ? "Ответ потерян. Повторите то же действие."
              : billingErrorMessage(readFailure))}
        </p>
      ) : null}
      {notice !== undefined ? <p role="status">{notice}</p> : null}
      <ul className="grid divide-y divide-border">
        {rows.map((row) => (
          <li
            key={`${row.accountId}:${row.productId}`}
            className="grid gap-2 py-3 text-sm break-words"
          >
            <p>
              {row.accountId} · {row.productId}
            </p>
            <p>
              {row.access === "active" ? "Доступ открыт" : "Доступ отозван"} ·
              первая выдача{" "}
              {row.firstIssuedAt === null
                ? "дата неизвестна"
                : formatBillingDate(row.firstIssuedAt)}
            </p>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setAccountId(row.accountId);
                setProductId(row.productId);
                if (
                  detailPair?.accountId === row.accountId &&
                  detailPair.productId === row.productId
                ) {
                  void read.refetch();
                }
                setDetailPair({
                  accountId: row.accountId,
                  productId: row.productId,
                });
              }}
            >
              История права
            </Button>
          </li>
        ))}
      </ul>
      {cursor !== null ? (
        <Button
          className="min-h-11"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setListInput({
              limit: 50,
              cursor,
              ...(listInput?.accountId === undefined
                ? {}
                : { accountId: listInput.accountId }),
              ...(listInput?.productId === undefined
                ? {}
                : { productId: listInput.productId }),
            });
          }}
        >
          Следующая страница
        </Button>
      ) : null}
      {detail ? (
        <div className="grid gap-3 border-t border-border pt-4">
          <h3 className="font-semibold">История права</h3>
          <p>
            {detail.access === "active"
              ? "Бессрочный доступ открыт"
              : "Доступ отозван"}
            . Первая выдача{" "}
            {detail.firstIssuedAt === null
              ? "дата неизвестна"
              : formatBillingDate(detail.firstIssuedAt)}
          </p>
          <ul>
            {detail.sources.map((source) => (
              <li key={`${source.source}:${source.sourceRef}`}>
                {(
                  {
                    manual: "Ручная выдача",
                    paid: "Оплата",
                    purchase: "Оплата",
                    course: "Активация курса",
                    course_activation: "Активация курса",
                    legacy: "Прежнее основание",
                  } as Readonly<Record<string, string>>
                )[source.source] ?? source.source}{" "}
                · {source.reason} · {formatBillingDate(source.issuedAt)}
              </li>
            ))}
          </ul>
          <ul>
            {detail.actions.map((action) => (
              <li key={action.id}>
                {(
                  {
                    issue: "Выдача",
                    source_recorded: "Запись источника",
                    revoke: "Отзыв",
                    restore: "Восстановление",
                    revoked: "Отзыв",
                  } as Readonly<Record<string, string>>
                )[action.kind] ?? action.kind}{" "}
                · {action.reason} · {formatBillingDate(action.recordedAt)}
              </li>
            ))}
          </ul>
          {detail.access === "revoked" ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const input = {
                  accountId,
                  productId,
                  expectedRevision: detail.revision,
                  reason: formText(form.get("reason")),
                };
                restore.mutate({
                  ...input,
                  operationId: repeat.operationId("restore", input),
                });
              }}
            >
              <AdminField
                label="Причина восстановления"
                name="reason"
                required
                maxLength={1000}
              />
              <Button className="min-h-11" disabled={busy} type="submit">
                Явно восстановить доступ
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          issue.mutate({
            accountId,
            productId,
            sourceRef: formText(form.get("sourceRef")),
            reason: formText(form.get("reason")),
          });
        }}
      >
        <h3 className="font-semibold">Ручная выдача</h3>
        <AdminField
          label="Основание выдачи"
          name="sourceRef"
          required
          maxLength={256}
        />
        <AdminField
          label="Причина выдачи"
          name="reason"
          required
          maxLength={1000}
        />
        <Button
          className="min-h-11"
          disabled={busy || accountId.length === 0 || productId.length === 0}
          type="submit"
        >
          Выдать бессрочный доступ
        </Button>
      </form>
      {accountId.length > 0 ? (
        <ProductRevocationPanel
          accountId={accountId}
          onRevoked={() => {
            setDetailPair(null);
          }}
        />
      ) : null}
    </AdminSection>
  );
}
