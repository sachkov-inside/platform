"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { billingErrorMessage } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { listActivationRules, listSubscriptionTiers, saveActivationRule } from "../api/enrollments.browser";
import { saveRuleInputSchema } from "../model/enrollment-operations";
import { formText, AdminField, AdminSection } from "./admin-form.client";
export function ActivationRulesPanel() {
  const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations(); const cache = useQueryClient();
  const rules = useQuery({ queryKey: ["owner-activation-rules"], queryFn: async () => { const result = await listActivationRules({ operationId: crypto.randomUUID() }); if (!result.ok) throw new Error(billingErrorMessage(result.code)); return result.value.result.items; } });
  const tiers = useQuery({ queryKey: ["owner-subscription-tiers"], queryFn: async () => { const result = await listSubscriptionTiers({ operationId: crypto.randomUUID(), limit: 100 }); if (!result.ok) throw new Error(billingErrorMessage(result.code)); return result.value.result.items; } });
  const save = useMutation({ mutationFn: saveActivationRule, onSuccess: result => {
    if (!result.ok) { setError(billingErrorMessage(result.code)); return; } repeat.completeOperation("save-rule"); setError(undefined); setNotice("Правило сохранено."); void cache.invalidateQueries({ queryKey: ["owner-activation-rules"] });
  }, onError: () =>{  setError("Не удалось сохранить правило. Повторите запрос."); } });
  return <AdminSection title="Активация за курс" description="Код выбирает правило, но не подтверждает покупку. Право выдаётся только после проверки источника и текущей связи аккаунта.">
    {error || rules.isError ? <p role="alert">{error ?? rules.error?.message}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {rules.data?.map(rule => <div key={rule.id} className="grid gap-2 border-b border-border pb-4"><p className="font-semibold">{rule.name} · {rule.published ? "Опубликовано" : "Приостановлено"}</p><p className="text-sm [overflow-wrap:anywhere]">Код: {rule.code} · источник: {rule.sourceRef}</p><Button variant="outline" disabled={save.isPending} onClick={() => { const { revision, ...value } = rule; const command = { expectedRevision: revision, value: { ...value, published: !rule.published }, reason: rule.published ? "Приостановка владельцем" : "Публикация владельцем" }; save.mutate({ ...command, operationId: repeat.operationId("save-rule", command) }); }}>{rule.published ? "Приостановить" : "Опубликовать"}</Button></div>)}
    <form className="grid gap-4" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const tier = tiers.data?.find(item => item.tier.id === form.get("tier")); if (!tier) { setError("Выберите тариф."); return; }
      const command = { value: { id: formText(form.get("id")), code: formText(form.get("code")), name: formText(form.get("name")), tierId: tier.tier.id, tierRevision: tier.tier.revision, sourceRef: formText(form.get("source")), published: form.get("published") === "on", startsAt: new Date(`${formText(form.get("start"))}+03:00`).toISOString(), endsAt: null }, reason: formText(form.get("reason")) };
      const parsed = saveRuleInputSchema.safeParse({ ...command, operationId: repeat.operationId("save-rule", command) }); if (!parsed.success) { setError("Проверьте код, источник и даты."); return; } save.mutate(parsed.data);
    }}>
      <AdminField label="Идентификатор нового правила" name="id" required hint="Новый UUID. Код и источник после создания неизменны." />
      <AdminField label="Название правила" name="name" required /><AdminField label="Код активации" name="code" required pattern="[A-Za-z0-9_-]{1,40}" hint="До 40 латинских букв, цифр, дефисов или подчёркиваний." />
      <label className="grid gap-1 text-sm">Тариф<select name="tier" required className="min-h-11 rounded-xl border border-input bg-background px-3"><option value="">Выберите тариф</option>{tiers.data?.filter(item => item.availableForAssignment && !item.archived).map(item => <option value={item.tier.id} key={item.tier.id}>{item.tier.name}</option>)}</select></label>
      <AdminField label="Подтверждаемый источник курса" name="source" required hint="Постоянный идентификатор правила проверки курса в Telegram." /><AdminField label="Начало по Москве" name="start" type="datetime-local" required />
      <AdminField label="Причина" name="reason" required /><label className="flex gap-2 text-sm"><input type="checkbox" name="published" /> Опубликовать правило</label>
      <Button type="submit" disabled={save.isPending}>Создать правило</Button>
    </form>
  </AdminSection>;
}
