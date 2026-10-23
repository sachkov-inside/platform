"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  billingErrorMessage,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  saveBillingPromotion,
  archiveBillingPromotion,
} from "../api/billing-admin.browser";
import {
  savePromotionInputSchema,
  archiveInputSchema,
} from "../model/admin-operations";
import { AdminField, AdminSection, formText } from "./admin-form.client";

export function ProductPromotionsPanel({
  offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations();
  const save = useMutation({
    mutationFn: saveBillingPromotion,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      repeat.completeOperation("promotion");
      setError(undefined);
      setNotice(
        `Скидка сохранена. Идентификатор ${result.value.result.value.id}, редакция ${String(result.value.result.value.revision)}.`,
      );
    },
  });
  const archive = useMutation({
    mutationFn: archiveBillingPromotion,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      repeat.completeOperation("archive-promotion");
      setError(undefined);
      setNotice("Скидка архивирована. Сохранённые расчёты не изменены.");
    },
  });
  const busy = save.isPending || archive.isPending;
  return (
    <AdminSection
      title="Скидки продуктов"
      description="Банк получит цену одного сохранённого расчёта. При нескольких скидках применяется одна лучшая, без сложения процентов."
    >
      {error !== undefined || save.isError || archive.isError ? (
        <p role="alert">
          {error ?? "Ответ потерян. Повторите то же действие."}
        </p>
      ) : null}
      {notice !== undefined ? <p role="status">{notice}</p> : null}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const revision = formText(form.get("revision"));
          const code = formText(form.get("code"));
          const limit = formText(form.get("limit"));
          const input = {
            ...(revision.length > 0
              ? { expectedRevision: Number(revision) }
              : {}),
            value: {
              id: formText(form.get("id")),
              name: formText(form.get("name")),
              percent: Number(form.get("percent")),
              code: code.length === 0 ? null : code,
              startsAt: formText(form.get("startsAt")),
              endsAt: formText(form.get("endsAt")),
              usageLimit: limit.length > 0 ? Number(limit) : null,
              productIds: form
                .getAll("productId")
                .filter((value): value is string => typeof value === "string"),
            },
          };
          const parsed = savePromotionInputSchema.safeParse({
            ...input,
            operationId: repeat.operationId("promotion", input),
          });
          if (!parsed.success) {
            setError(
              "Проверьте идентификатор, процент, продукты и даты в ISO-формате с часовым поясом.",
            );
            return;
          }
          save.mutate(parsed.data);
        }}
      >
        <AdminField label="Идентификатор скидки" name="id" required />
        <AdminField
          label="Название скидки"
          name="name"
          required
          maxLength={200}
        />
        <AdminField
          label="Текущая редакция при изменении"
          name="revision"
          type="number"
          min={1}
          step={1}
        />
        <AdminField
          label="Скидка, процентов"
          name="percent"
          type="number"
          min={1}
          max={99}
          required
        />
        <AdminField
          label="Промокод, необязательно"
          name="code"
          maxLength={100}
        />
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">Продукты скидки</legend>
          {offers.map((item) =>
            item.product ? (
              <label
                className="flex min-h-11 items-center gap-2"
                key={item.product.id}
              >
                <input
                  type="checkbox"
                  name="productId"
                  value={item.product.id}
                />
                {item.product.name}
              </label>
            ) : null,
          )}
        </fieldset>
        <AdminField
          label="Начало, ISO с часовым поясом"
          name="startsAt"
          placeholder="2026-10-23T00:00:00+03:00"
          required
        />
        <AdminField
          label="Окончание, ISO с часовым поясом"
          name="endsAt"
          placeholder="2026-11-23T00:00:00+03:00"
          required
        />
        <AdminField
          label="Лимит использований, необязательно"
          name="limit"
          type="number"
          min={1}
          step={1}
        />
        <Button disabled={busy} type="submit">
          Сохранить скидку
        </Button>
      </form>
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const input = {
            id: formText(form.get("id")),
            expectedRevision: Number(form.get("revision")),
          };
          const parsed = archiveInputSchema.safeParse({
            ...input,
            operationId: repeat.operationId("archive-promotion", input),
          });
          if (!parsed.success) {
            setError("Проверьте идентификатор и редакцию скидки.");
            return;
          }
          archive.mutate(parsed.data);
        }}
      >
        <AdminField
          label="Идентификатор архивируемой скидки"
          name="id"
          required
        />
        <AdminField
          label="Редакция архивируемой скидки"
          name="revision"
          type="number"
          min={1}
          step={1}
          required
        />
        <Button disabled={busy} type="submit" variant="outline">
          Архивировать скидку
        </Button>
      </form>
    </AdminSection>
  );
}
