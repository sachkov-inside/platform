"use client";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { billingErrorMessage } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { registerSubscriptionSource } from "../api/enrollments.browser";
import { registerSourceInputSchema } from "../model/enrollment-operations";
import { AdminField, AdminSection, formText } from "./admin-form.client";
export function SubscriptionSourcePanel() {
  // Время читается при первой отправке: предсборка не видит часов, а повтор команды получает тот же `operationId`.
  const checkedAt = useRef<string | undefined>(undefined);
  const [message, setMessage] = useState<string>();
  const repeat = useRepeatableOperations();
  const mutation = useMutation({
    mutationFn: registerSubscriptionSource,
    onSuccess: (result) => {
      if (!result.ok) {
        setMessage(billingErrorMessage(result.code));
        return;
      }
      repeat.completeOperation("source");
      setMessage(
        result.value.result.value.accountId === null
          ? "Источник сохранён до появления аккаунта. Права пока не назначены."
          : "Подтверждение источника сохранено.",
      );
    },
    onError: () => {
      setMessage("Не удалось сохранить. Повторите запрос.");
    },
  });
  return (
    <AdminSection
      title="Подтверждение до регистрации"
      description="Сохраните проверенный курс для известного пользователя источника. Tribute переносится в разделе «Перенос доступа из Tribute». Запись не создаёт аккаунт, платёж или право сама по себе."
    >
      {message ? <p role="status">{message}</p> : null}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const now = (checkedAt.current ??= new Date().toISOString());
          const command = {
            origin: "course",
            sourcePolicyRef: formText(form.get("policy")),
            identityRef: formText(form.get("identity")),
            checkedAt: now,
            startsAt: now,
            endsAt: null,
            reason: formText(form.get("reason")),
          };
          const parsed = registerSourceInputSchema.safeParse({
            ...command,
            operationId: repeat.operationId("source", command),
          });
          if (!parsed.success) {
            setMessage("Проверьте источник, пользователя и срок.");
            return;
          }
          mutation.mutate(parsed.data);
        }}
      >
        <AdminField name="policy" label="Правило проверки источника" required />
        <AdminField
          name="identity"
          label="Проверенный пользователь источника"
          required
        />
        <AdminField name="reason" label="Подтверждение проверки" required />
        <Button type="submit" disabled={mutation.isPending}>
          Сохранить подтверждение
        </Button>
      </form>
    </AdminSection>
  );
}
