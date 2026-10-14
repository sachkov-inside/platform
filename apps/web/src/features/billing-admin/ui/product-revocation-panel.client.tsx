"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  accessSourceLabel,
  billingErrorMessage,
  formatBillingDate,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { readContentCatalog } from "../api/enrollments.browser";
import {
  previewProductRevocation,
  revokeProductAccess,
} from "../api/product-revocation.browser";

export function ProductRevocationPanel({
  accountId,
  onRevoked,
}: {
  readonly accountId: string;
  readonly onRevoked: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const catalog = useQuery({
    queryKey: ["authoring", "content-catalog"],
    queryFn: readContentCatalog,
    retry: false,
  });
  const products =
    catalog.data?.ok === true
      ? catalog.data.value.result.items.filter(
          (entry) => entry.kind === "product",
        )
      : [];
  const { operationId, completeOperation } = useRepeatableOperations();
  const preview = useMutation({
    mutationFn: previewProductRevocation,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) setError(billingErrorMessage(result.code));
    },
  });
  const revoke = useMutation({
    mutationFn: revokeProductAccess,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        preview.reset();
        return;
      }
      completeOperation("product-revoke");
      preview.reset();
      setMessage("Доступ к продукту отозван. Оплаты и прогресс сохранены.");
      onRevoked();
    },
  });
  const proof = preview.data?.ok === true ? preview.data.value.value : null;
  const name =
    products.find((entry) => entry.id === productId)?.title ?? "Продукт";
  const busy = preview.isPending || revoke.isPending;
  return (
    <section
      className="grid gap-3 rounded-xl border border-border p-4"
      aria-label={`Отзыв доступа к продукту для Account ${accountId}`}
    >
      <h3 className="font-semibold">Отозвать доступ к продукту</h3>
      <label className="grid gap-2 text-sm">
        Продукт
        <select
          className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-base"
          value={productId}
          disabled={busy}
          onChange={(event) => {
            setProductId(event.target.value);
            preview.reset();
            setError(undefined);
            setMessage("");
          }}
        >
          <option value="">Выберите продукт</option>
          {products.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      {catalog.isError || catalog.data?.ok === false ? (
        <p role="alert">Не удалось загрузить продукты.</p>
      ) : null}
      {proof === null ? (
        <Button
          type="button"
          variant="outline"
          disabled={productId === "" || busy}
          onClick={() => {
            setError(undefined);
            preview.mutate({ accountId, productId });
          }}
        >
          Проверить доступ
        </Button>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim() === "" || busy) return;
            const input = {
              accountId,
              productId,
              expectedRevision: proof.revision,
              reason: reason.trim(),
            };
            revoke.mutate({
              ...input,
              operationId: operationId("product-revoke", input),
            });
          }}
        >
          <p>
            Будет отозван доступ к «{name}» по всем текущим основаниям. Другие
            продукты останутся доступны.
          </p>
          <ul className="grid gap-1 text-sm">
            {proof.affected.map((ground, index) => (
              <li key={index}>
                {accessSourceLabel(ground.source)}
                {ground.validUntil === null
                  ? " без даты окончания"
                  : ` до ${formatBillingDate(ground.validUntil)}`}
                .
              </li>
            ))}
          </ul>
          <label className="grid gap-2 text-sm">
            Причина
            <input
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <Button type="submit" variant="destructive" disabled={busy}>
            {revoke.isPending
              ? "Отзываем доступ…"
              : "Отозвать доступ к продукту"}
          </Button>
        </form>
      )}
      {message === "" ? null : <p role="status">{message}</p>}
      {error === undefined ? null : <p role="alert">{error}</p>}
    </section>
  );
}
