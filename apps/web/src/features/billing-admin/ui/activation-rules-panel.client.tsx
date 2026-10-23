"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  billingErrorMessage,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  listActivationRules,
  saveActivationRule,
} from "../api/enrollments.browser";
import { saveRuleInputSchema } from "../model/enrollment-operations";
import { formText, AdminField, AdminSection } from "./admin-form.client";

export function ActivationRulesPanel({
  offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations();
  const cache = useQueryClient();
  const rules = useQuery({
    queryKey: ["owner-activation-rules"],
    queryFn: async () => {
      const result = await listActivationRules({
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result.items;
    },
  });
  const save = useMutation({
    mutationFn: saveActivationRule,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      repeat.completeOperation("save-rule");
      setError(undefined);
      setNotice("Правило сохранено.");
      void cache.invalidateQueries({ queryKey: ["owner-activation-rules"] });
    },
    onError: () => {
      setError("Ответ потерян. Повторите то же действие.");
    },
  });
  return (
    <AdminSection
      title="Ссылки активации курса"
      description="Код выбирает правило. Право выдаётся после проверки отдельного источника курса и текущей связи аккаунта."
    >
      {error !== undefined || rules.isError ? (
        <p role="alert">{error ?? rules.error?.message}</p>
      ) : null}
      {notice !== undefined ? <p role="status">{notice}</p> : null}
      {rules.isPending ? <p role="status">Загружаем правила…</p> : null}
      {rules.data?.map((rule) => (
        <div className="grid gap-3 border-b border-border pb-4" key={rule.id}>
          <p>
            {rule.name} · {rule.published ? "Опубликовано" : "Приостановлено"}
          </p>
          <p className="text-sm break-words">
            Код: {rule.code} · источник: {rule.sourceRef}
          </p>
          <p>
            {offers.find((item) => item.product?.id === rule.productId)?.product
              ?.name ?? rule.productId}
          </p>
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              const { revision, ...value } = rule;
              const command = {
                expectedRevision: revision,
                value: { ...value, published: !rule.published },
                reason: "Изменение публикации владельцем",
              };
              save.mutate({
                ...command,
                operationId: repeat.operationId("save-rule", command),
              });
            }}
          >
            {rule.published ? "Приостановить" : "Опубликовать"}
          </Button>
        </div>
      ))}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const command = {
            value: {
              id: formText(form.get("id")),
              name: formText(form.get("name")),
              code: formText(form.get("code")),
              productId: formText(form.get("productId")),
              sourceRef: formText(form.get("source")),
              verificationMode: "course_membership",
              published: form.get("published") === "on",
              startsAt: new Date().toISOString(),
              endsAt: null,
            },
            reason: formText(form.get("reason")),
          };
          const parsed = saveRuleInputSchema.safeParse({
            ...command,
            operationId: repeat.operationId("save-rule", command),
          });
          if (!parsed.success) {
            setError("Проверьте продукт, код, источник и причину.");
            return;
          }
          save.mutate(parsed.data);
        }}
      >
        <AdminField label="Идентификатор нового правила" name="id" required />
        <AdminField label="Название правила" name="name" required />
        <AdminField
          label="Код активации"
          name="code"
          required
          pattern="[A-Za-z0-9_-]{1,40}"
        />
        <AdminField label="Идентификатор продукта" name="productId" required />
        <AdminField
          label="Подтверждаемый источник курса"
          name="source"
          required
        />
        <AdminField label="Причина" name="reason" required />
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="published" />
          Опубликовать правило
        </label>
        <Button type="submit" disabled={save.isPending}>
          Создать правило
        </Button>
      </form>
    </AdminSection>
  );
}
