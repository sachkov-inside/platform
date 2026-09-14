"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { billingErrorMessage } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { registerSubscriptionSource } from "../api/enrollments.browser";
import { registerSourceInputSchema } from "../model/enrollment-operations";
import { AdminField, AdminSection, formText } from "./admin-form.client";
export function SubscriptionSourcePanel() {
 const [checkedAt] = useState(() => new Date().toISOString());
 const [origin, setOrigin] = useState("course"), [message, setMessage] = useState<string>(); const repeat = useRepeatableOperations();
 const mutation = useMutation({ mutationFn: registerSubscriptionSource, onSuccess: result => { if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; } repeat.completeOperation("source"); setMessage(result.value.result.value.accountId === null ? "Источник сохранён до появления аккаунта. Права пока не назначены." : "Подтверждение источника сохранено."); }, onError: () => { setMessage("Не удалось сохранить. Повторите запрос."); } });
 return <AdminSection title="Подтверждение до регистрации" description="Сохраните проверенный курс или период Tribute для известного пользователя источника. Запись не создаёт аккаунт, платёж или право сама по себе.">
 {message ? <p role="status">{message}</p> : null}<form className="grid gap-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const now = checkedAt; const end = formText(form.get("endsAt")); const command = { origin, sourcePolicyRef: formText(form.get("policy")), identityRef: formText(form.get("identity")), checkedAt: now, startsAt: now, endsAt: origin === "course" ? null : new Date(`${end}+03:00`).toISOString(), reason: formText(form.get("reason")) }; const parsed = registerSourceInputSchema.safeParse({ ...command, operationId: repeat.operationId("source", command) }); if (!parsed.success) { setMessage("Проверьте источник, пользователя и срок."); return; } mutation.mutate(parsed.data); }}>
 <label className="grid gap-1 text-sm">Внешний источник<select className="min-h-11 rounded-xl border border-input bg-background px-3" value={origin} onChange={event => { setOrigin(event.target.value); }}><option value="course">Курс</option><option value="tribute">Tribute</option></select></label>
 <AdminField name="policy" label="Правило проверки источника" required /><AdminField name="identity" label="Проверенный пользователь источника" required />
 {origin === "tribute" ? <AdminField name="endsAt" label="Подтверждено до, по Москве" type="datetime-local" required /> : null}
 <AdminField name="reason" label="Подтверждение проверки" required /><Button type="submit" disabled={mutation.isPending}>Сохранить подтверждение</Button>
 </form></AdminSection>;
}
