"use client";
import { EnrollmentExpansionPanel } from "./enrollment-expansion-panel.client";
import type { z } from "zod";
import type { recipientSchema } from "../model/enrollment-operations";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { announceEnrollmentChange, EnrollmentList, billingErrorMessage, type Enrollment } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { lookupSubscriptionRecipient, assignSubscriptionEnrollment, changeSubscriptionEnrollment, listSubscriptionTiers } from "../api/enrollments.browser";
import { assignEnrollmentInputSchema, changeEnrollmentInputSchema } from "../model/enrollment-operations";
import { formText, AdminField, AdminSection } from "./admin-form.client";

import { useOwnerEnrollments } from "../model/use-owner-enrollments.client";
export function EnrollmentAdminPanel() {
  const [courseStart] = useState(() => new Date().toISOString());
  const [identity, setIdentity] = useState("");
  const [recipient, setRecipient] = useState<z.infer<typeof recipientSchema>>();
  const account = recipient?.accountId ?? "";
  const [target, setTarget] = useState("");
  const [origin, setOrigin] = useState<"manual" | "course" | "tribute">("manual");
  const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations(); const cache = useQueryClient();
  const tiers = useQuery({ queryKey: ["owner-subscription-tiers"], queryFn: async () => {
    const result = await listSubscriptionTiers({ operationId: crypto.randomUUID(), limit: 100 });
    if (!result.ok) throw new Error(billingErrorMessage(result.code)); return result.value.result.items;
  } });
  const assignments = useOwnerEnrollments(target);
  const assign = useMutation({ mutationFn: assignSubscriptionEnrollment, onSuccess: result => {
    if (!result.ok) { setError(billingErrorMessage(result.code)); return; }
    announceEnrollmentChange(); repeat.completeOperation("assign-tier"); setNotice("Тариф назначен. Платёж и расписание списаний не создавались.");
    setError(undefined); setTarget(result.value.result.value.accountId); void cache.invalidateQueries({ queryKey: ["owner-enrollments"] });
  } });
  const change = useMutation({ mutationFn: changeSubscriptionEnrollment, onSuccess: result => {
    if (!result.ok) { setError(billingErrorMessage(result.code)); return; }
    announceEnrollmentChange(); repeat.completeOperation("change-tier"); setError(undefined); setNotice("Назначение обновлено. Остальные права сохранены.");
    void cache.invalidateQueries({ queryKey: ["owner-enrollments"] });
  } });
  const lookup = useMutation({ mutationFn: lookupSubscriptionRecipient, onSuccess: result => {
    setRecipient(undefined); setTarget("");
    if (!result.ok) { setError(billingErrorMessage(result.code)); return; }
    const value = result.value.result.value;
    if (value.state !== "found") { setError(value.state === "ambiguous" ? "Найдено несколько связей. Назначение недоступно до проверки связи." : "Подтверждённый аккаунт не найден. Проверьте точный идентификатор Telegram."); return; }
    setError(undefined); setRecipient(value.recipient);
  }, onError: () => { setError("Не удалось найти аккаунт. Повторите запрос."); } });
  const pending = assign.isPending || change.isPending;
  function changeExisting(event: React.SubmitEvent<HTMLFormElement>, enrollment: Enrollment) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const action = formText(data.get("action"));
    if (action !== "restore" && action !== "revoke" && action !== "change_term") return;
    const end = formText(data.get(`endsAt-${enrollment.id}`) ?? "");
    const command = { enrollmentId: enrollment.id, expectedRevision: enrollment.revision, action,
      terms: { startsAt: enrollment.startsAt, endsAt: end === "" ? null : new Date(`${end}+03:00`).toISOString(), endPolicy: enrollment.endPolicy }, reason: formText(data.get("reason")) };
    const parsed = changeEnrollmentInputSchema.safeParse({ ...command, operationId: repeat.operationId("change-tier", command) });
    if (!parsed.success) { setError("Проверьте срок и причину изменения."); return; }
    change.mutate(parsed.data);
  }
  return <AdminSection title="Тарифы и назначения" description="Назначение не требует продажи или оплаты. Разовые покупки и другие основания остаются независимыми.">
    {error || tiers.isError || assignments.isError ? <p role="alert" className="text-destructive">{error ?? tiers.error?.message ?? assignments.error?.message}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <form className="grid gap-4" onSubmit={event => { event.preventDefault(); lookup.mutate({ operationId: crypto.randomUUID(), identityRef: identity }); }}>
      <AdminField label="Подтверждённая Telegram identity получателя" name="recipient-identity" value={identity} onChange={event => { setIdentity(event.target.value); setRecipient(undefined); setTarget(""); }} required hint="Точный идентификатор подтверждённой связи, не username." />
      <Button type="submit" disabled={lookup.isPending}>Найти получателя</Button>
    </form>
    {recipient ? <div className="grid gap-2 rounded-xl border border-border p-4 text-sm [overflow-wrap:anywhere]">
      <p>Подтверждённая связь: {recipient.identityRef}</p><p>Аккаунт: {recipient.accountId}</p>
      <Button variant="outline" onClick={() => { setTarget(account); if (target === account) void assignments.refetch(); }}>Выбрать получателя и показать назначения</Button>
    </div> : null}
    {assignments.isFetching ? <p role="status">Загружаем назначения…</p> : null}
    {assignments.data ? <><EnrollmentList items={assignments.data} />{assignments.data.map(enrollment => <form key={enrollment.id} className="grid gap-3 border-b border-border pb-5" onSubmit={event =>{  changeExisting(event, enrollment); }}>
      <h3 className="font-semibold">Изменить «{enrollment.tier.name}»</h3>
      <label className="grid gap-1 text-sm">Действие<select name="action" className="min-w-0 w-full min-h-11 rounded-xl border border-input bg-background px-3" defaultValue={enrollment.state === "revoked" ? "restore" : "change_term"}>
        <option value="change_term">Изменить срок</option><option value="revoke">Отозвать</option><option value="restore">Восстановить</option></select></label>
      <AdminField label="Окончание по Москве (пусто — без даты)" name={`endsAt-${enrollment.id}`} type="datetime-local" defaultValue={enrollment.endsAt === null ? "" : new Date(new Date(enrollment.endsAt).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16)} disabled={enrollment.origin === "course"} />
      <label className="grid gap-1 text-sm">Причина<input required name="reason" className="min-h-11 rounded-xl border border-input bg-background px-3" /></label>
      <Button type="submit" disabled={pending}>Применить изменение</Button>
    </form>)}</> : null}
    {assignments.data && tiers.data ? <EnrollmentExpansionPanel items={assignments.data} tiers={tiers.data} /> : null}
    <form className="grid gap-4 border-t border-border pt-5" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const tier = tiers.data?.find(row => row.tier.id === data.get("tier"));
      if (!tier) { setError("Выберите тариф, доступный для назначения."); return; }
      const end = formText(data.get("end") ?? ""); const start = formText(data.get("start") ?? "");
      const command = { accountId: target, origin, sourceRef: formText(data.get("sourceRef")), tierId: tier.tier.id, tierRevision: tier.tier.revision,
        terms: { startsAt: start === "" ? courseStart : new Date(`${start}+03:00`).toISOString(), endsAt: origin === "course" || end === "" ? null : new Date(`${end}+03:00`).toISOString(), endPolicy: origin === "tribute" ? "confirmed_external" : "fixed" },
        billingRef: null, reason: formText(data.get("reason")), ...(origin === "course" ? { courseSource: { policyRef: formText(data.get("sourceRef")), verifiedIdentityRef: recipient?.identityRef ?? "" } } : {}) };
      const parsed = assignEnrollmentInputSchema.safeParse({ ...command, operationId: repeat.operationId("assign-tier", command) });
      if (!parsed.success) { setError("Проверьте аккаунт, источник, причину и даты назначения."); return; } assign.mutate(parsed.data);
    }}>
      <h3 className="text-lg font-semibold">Назначить тариф</h3>
      <label className="grid gap-1 text-sm">Тариф<select name="tier" required className="min-w-0 w-full min-h-11 rounded-xl border border-input bg-background px-3"><option value="">Выберите тариф</option>{tiers.data?.filter(row => row.availableForAssignment && !row.archived).map(row => <option value={row.tier.id} key={row.tier.id}>{row.tier.name}{row.published ? "" : " · не продаётся"}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Источник<select value={origin} onChange={event => { const value = event.target.value; if (value === "manual" || value === "course" || value === "tribute") setOrigin(value); }} className="min-h-11 rounded-xl border border-input bg-background px-3"><option value="manual">Решение владельца</option><option value="course">Подтверждённая покупка курса</option><option value="tribute">Подтверждённый период Tribute</option></select></label>
      <label className="grid gap-1 text-sm">Постоянный источник<input name="sourceRef" required className="min-h-11 rounded-xl border border-input bg-background px-3" /></label>
      {origin === "course" ? <label className="grid gap-1 text-sm">Подтверждённая Telegram identity<input name="identityRef" value={recipient?.identityRef ?? ""} readOnly className="min-h-11 rounded-xl border border-input bg-background px-3" /></label> : <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1 text-sm">Начало по Москве<input name="start" type="datetime-local" required className="min-h-11 rounded-xl border border-input bg-background px-3" /></label><label className="grid gap-1 text-sm">Окончание по Москве<input name="end" type="datetime-local" required={origin === "tribute"} className="min-h-11 rounded-xl border border-input bg-background px-3" /></label></div>}
      <label className="grid gap-1 text-sm">Причина и подтверждение<input name="reason" required className="min-h-11 rounded-xl border border-input bg-background px-3" /></label>
      {origin === "course" ? <p className="text-sm text-muted-foreground">Без даты окончания и списаний. Начало фиксируется при первом назначении.</p> : null}
      <Button type="submit" disabled={pending || tiers.isPending || target === ""}>Назначить без оплаты</Button>
    </form>
  </AdminSection>;
}
