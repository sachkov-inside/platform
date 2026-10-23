"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import {
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
} from "../api/product-access.operation";
import type {
  productAccessSchema,
  productAccessDetailSchema,
} from "../model/product-access";
import { AdminField, AdminSection, formText } from "./admin-form.client";
import { ProductRevocationPanel } from "./product-revocation-panel.client";

type Access = z.infer<typeof productAccessSchema>;
type Detail = z.infer<typeof productAccessDetailSchema>;
export function ProductAccessPanel() {
  const [accountId, setAccountId] = useState("");
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState<readonly Access[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations();
  const list = useMutation({
    mutationFn: listProductAccessOperation.send,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      setRows(result.value.value);
      setCursor(result.value.nextCursor);
      setError(undefined);
    },
  });
  const read = useMutation({
    mutationFn: readProductAccessOperation.send,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      setDetail(result.value.value);
      setError(undefined);
    },
  });
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
      read.mutate({ accountId, productId });
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
      read.mutate({ accountId, productId });
    },
  });
  const busy =
    list.isPending || read.isPending || issue.isPending || restore.isPending;
  const lost = list.isError || read.isError || issue.isError || restore.isError;
  function refresh() {
    list.mutate({
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
            setDetail(null);
          }}
        />
        <AdminField
          label="Продукт"
          name="productId"
          disabled={busy}
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setDetail(null);
          }}
        />
      </div>
      <Button className="min-h-11" disabled={busy} onClick={refresh}>
        Показать права
      </Button>
      {error !== undefined || lost ? (
        <p role="alert">
          {error ?? "Ответ потерян. Повторите то же действие."}
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
              первая выдача {formatBillingDate(row.firstIssuedAt)}
            </p>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAccountId(row.accountId);
                setProductId(row.productId);
                read.mutate({
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
            list.mutate({
              limit: 50,
              cursor,
              ...(accountId.length > 0 ? { accountId } : {}),
              ...(productId.length > 0 ? { productId } : {}),
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
            . Первая выдача {formatBillingDate(detail.firstIssuedAt)}.
          </p>
          <ul>
            {detail.sources.map((source) => (
              <li key={`${source.source}:${source.sourceRef}`}>
                {source.source} · {source.reason} ·{" "}
                {formatBillingDate(source.issuedAt)}
              </li>
            ))}
          </ul>
          <ul>
            {detail.actions.map((action) => (
              <li key={action.revision}>
                {action.kind} · {action.reason} ·{" "}
                {formatBillingDate(action.recordedAt)}
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
            setDetail(null);
            refresh();
          }}
        />
      ) : null}
    </AdminSection>
  );
}
