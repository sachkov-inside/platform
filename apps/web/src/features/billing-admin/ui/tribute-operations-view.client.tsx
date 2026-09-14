"use client";
import { useState } from "react";
import { z } from "zod";
import type { tierSchema } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { parseTributeCsv, tributeCsvTemplate } from "../model/tribute-import";
import { dismissTributeImportSchema, type previewTributeImportSchema, reconcileTributeSchema, retryTributeInboxSchema, saveTributePolicySchema,
  type tributeOperationsViewSchema, type tributePreviewSchema } from "../model/tribute-operations";
import { AdminField, AdminSection, AdminSelect, AdminTextArea, formText, onAdminSubmit } from "./admin-form.client";

type Data = z.infer<typeof tributeOperationsViewSchema>;
type PolicyInput = Omit<z.infer<typeof saveTributePolicySchema>, "operationId">;
type PreviewInput = Omit<z.infer<typeof previewTributeImportSchema>, "operationId">;
type ReconcileInput = Omit<z.infer<typeof reconcileTributeSchema>, "operationId">;
type InboxInput = Omit<z.infer<typeof retryTributeInboxSchema>, "operationId">;
interface Props {
  readonly data: Data | null; readonly tiers: readonly z.infer<typeof tierSchema>[];
  readonly preview: z.infer<typeof tributePreviewSchema> | null;
  readonly loading: boolean; readonly busy: boolean; readonly error: string | null; readonly message: string;
  readonly onPage: (page: number) => void; readonly onMessage: (message: string) => void; readonly onRefresh: () => void;
  readonly onPolicy: (input: PolicyInput) => void; readonly onPreview: (input: PreviewInput) => void;
  readonly onApply: (rows: string[]) => void; readonly onRecover: () => void;
  readonly onDismiss: (input: Omit<z.infer<typeof dismissTributeImportSchema>, "operationId">) => void;
  readonly onReconcile: (input: ReconcileInput) => void; readonly onInbox: (input: InboxInput) => void;
}
const sourceLabels = { pending_identity: "Ожидает привязки аккаунта", active: "Действует", scheduled: "Начнётся позже", expired: "Срок завершён", revoked: "Отозвано", pending_verification: "Ожидает проверки", suspended_source: "Источник приостановлен" };
const previewLabels = { new: "Новое основание", matched: "Сопоставлено", pending_identity: "До регистрации", ambiguous: "Нужна проверка получателя", unknown_term: "Неизвестен срок", conflict: "Конфликт" };
const dateHint = "Точная дата в UTC, например 2030-01-01T00:00:00.000Z. Не рассчитывайте её по сумме платежа.";

/** Owner presentation; all policy decisions and writes remain in Platform. */
export function TributeOperationsView(props: Props) {
  const [csv, setCsv] = useState(""); const [policyId, setPolicyId] = useState("");
  const policy = props.data?.policies.find(item => item.id === policyId);
  return <AdminSection title="Перенос доступа из Tribute" description="Сначала подтвердите получателей и сроки, затем проверьте preview. Источник без аккаунта сохранится до подтверждённой привязки. Импорт не создаёт платёж.">
    <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={props.onRefresh}>Обновить состояние</Button><Button variant="outline" disabled={props.busy} onClick={props.onRecover}>Восстановить результат применения</Button></div>
    {props.loading ? <p role="status">Загружаем источники Tribute…</p> : null}
    {props.error ? <p role="alert">{props.error}</p> : null}
    <p role="status" aria-live="polite" className="break-words text-sm">{props.message}</p>
    {props.data ? <div className="grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-2">
      <p>Неразобранные сверки: {props.data.metrics.unresolvedImports}</p><p>До регистрации: {props.data.metrics.pendingIdentity}</p><p>События для разбора: {props.data.metrics.unresolvedEvents}</p>
      <p>Временные основания: {props.data.metrics.temporarySources}</p><p>Давно не проверялись: {props.data.metrics.staleConfirmations}</p>
      <p className="sm:col-span-2">{props.data.metrics.rolloutBlocked ? "Массовое переключение требует разбора оставшихся источников." : "В этом реестре нет незавершённых проверок. Включение внешних источников требует отдельных проверок запуска."}</p>
    </div> : null}
    <details><summary className="cursor-pointer font-semibold">1. Настроить разрешённый источник</summary>
      <label className="mt-4 grid gap-1 text-sm">Источник<select className="min-h-11 rounded-xl border border-input bg-background px-3" value={policyId} onChange={event => { setPolicyId(event.target.value); }}>
        <option value="">Новый источник</option>{props.data?.policies.map(item => <option key={item.id} value={item.id}>{item.id} · {item.tier.name}</option>)}
      </select></label>
      <form key={policyId} className="mt-4 grid gap-4" onSubmit={onAdminSubmit(form => {
        const tier = props.tiers.find(item => item.id === formText(form.get("tier")));
        const input = { id: policy?.id ?? formText(form.get("id")), subscriptionId: Number(formText(form.get("subscriptionId"))),
          expectedRevision: policy?.revision ?? 0, enabled: form.get("enabled") === "on", tierId: tier?.id, tierRevision: tier?.revision,
          temporaryUntil: formText(form.get("temporaryUntil")) || null, reason: formText(form.get("reason")) };
        const parsed = saveTributePolicySchema.omit({ operationId: true }).safeParse(input);
        if (!parsed.success) { props.onMessage("Проверьте источник, subscription ID, тариф и дату ограничения."); return; }
        props.onPolicy(parsed.data);
      })}>
        {!policy ? <AdminField label="Стабильное обозначение источника" name="id" required /> : null}
        <AdminField label="Subscription ID из подтверждённого источника Tribute" name="subscriptionId" type="number" min={1} defaultValue={policy?.subscriptionId} readOnly={Boolean(policy)} required />
        <AdminSelect label="Назначаемый тариф" name="tier" defaultValue={policy?.tier.id ?? props.tiers[0]?.id ?? ""} options={props.tiers.map(item => ({ value: item.id, label: `${item.name} · версия ${String(item.revision)}` }))} />
        <AdminField label="Временный режим разрешён только до (необязательно)" name="temporaryUntil" defaultValue={policy?.temporaryUntil ?? ""} hint={dateHint} />
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? false} /> Разрешить подтверждённые назначения этого источника</label>
        <AdminField label="Основание решения" name="reason" required maxLength={1000} />
        <Button type="submit" disabled={props.busy || props.tiers.length === 0}>Сохранить источник</Button>
      </form>
    </details>
    <details open><summary className="cursor-pointer font-semibold">2. Загрузить подтверждённый реестр</summary>
      <p className="mt-3 text-sm text-muted-foreground">CSV до 100 строк. Пустые identity и даты останутся на проверке. Даты — UTC; режим confirmed_period означает подтверждённый период, temporary_membership — отдельно разрешённую прежнюю аудиторию. Никогда не подставляйте username вместо проверенной identity.</p>
      <a className="mt-3 inline-block underline underline-offset-4" href={`data:text/csv;charset=utf-8,${encodeURIComponent(tributeCsvTemplate)}`} download="tribute-import-template.csv">Скачать шаблон CSV</a>
      <form className="mt-4 grid gap-4" onSubmit={onAdminSubmit(form => {
        try { const rows = parseTributeCsv(csv); props.onPreview({ batchRef: formText(form.get("batchRef")), rows }); }
        catch (error) { props.onMessage(error instanceof Error ? error.message : "Не удалось прочитать реестр."); }
      })}>
        <AdminField name="batchRef" label="Название сверки" placeholder="tribute-2026-09-confirmed" required maxLength={256} />
        <AdminField name="file" label="CSV-файл" type="file" accept=".csv,text/csv" onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > 262144) { props.onMessage("Файл должен быть не больше 256 КБ."); return; }
          void file.text().then(setCsv).catch(() => { props.onMessage("Не удалось прочитать файл."); });
        }} />
        <AdminTextArea label="Содержимое реестра" name="csv" value={csv} onChange={event => { setCsv(event.target.value); }} required />
        <Button disabled={props.busy} type="submit">Проверить без применения</Button>
      </form>
    </details>
    {props.preview ? <form key={props.preview.previewRef} className="grid gap-4" onSubmit={onAdminSubmit(form => { props.onApply(form.getAll("row").filter((value): value is string => typeof value === "string")); })}>
      <h3 className="font-semibold">3. Проверить и применить выбранное</h3><p className="text-sm">Preview действителен до {props.preview.expiresAt}. Изменение источника или привязки потребует новой проверки.</p>
      {props.preview.rows.map(row => <label key={row.rowRef} className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
        <input className="mt-1 size-4" type="checkbox" name="row" value={row.rowRef} disabled={!["new", "matched", "pending_identity"].includes(row.status)} />
        <span className="grid min-w-0 gap-1 break-words"><strong>{row.rowRef} · {previewLabels[row.status]}</strong><span>{row.detail}</span>
          <span>{row.tier?.name ?? "Тариф не подтверждён"} · {row.startsAt ?? "Начало неизвестно"} → {row.endsAt ?? "Конец неизвестен"}</span>
          {row.shortens ? <strong>Выбранная строка сократит ранее подтверждённый срок.</strong> : null}</span>
      </label>)}
      <Button type="submit" disabled={props.busy}>Применить выбранные строки</Button>
    </form> : null}
    {props.data ? <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={props.data.page === 0} onClick={() => { props.onPage(Math.max(0, (props.data?.page ?? 0) - 1)); }}>Предыдущая страница</Button><span className="text-sm">Источники и события · страница {props.data.page + 1}</span><Button variant="outline" disabled={!props.data.hasMore} onClick={() => { props.onPage((props.data?.page ?? 0) + 1); }}>Следующая страница</Button></div> : null}
    <details><summary className="cursor-pointer font-semibold">Неразобранные строки прежних сверок</summary>
      <p className="mt-3 text-sm">Истечение preview не закрывает неизвестные строки. Загрузите исправленный реестр, затем явно закройте прежнюю сверку с объяснением.</p>
      {props.data?.imports.filter(item => item.state === "pending").map(item => <form key={`${item.previewRef}:${String(item.revision)}`} className="mt-4 grid gap-3 border-b border-border pb-4" onSubmit={onAdminSubmit(form => {
        const parsed = dismissTributeImportSchema.omit({ operationId: true }).safeParse({ previewRef: item.previewRef, expectedRevision: item.revision, reason: formText(form.get("reason")) });
        if (parsed.success) props.onDismiss(parsed.data); else props.onMessage("Укажите причину закрытия оставшихся строк.");
      })}><p className="break-words font-semibold">{item.batchRef}</p><p className="break-words text-sm">Не применены: {item.pendingRows.join(", ")}</p><AdminField name="reason" label="Почему оставшиеся строки больше не требуют переноса" required maxLength={1000} /><Button variant="outline" disabled={props.busy} type="submit">Закрыть оставшиеся строки с причиной</Button></form>)}
    </details>
    <details><summary className="cursor-pointer font-semibold">Источники и восстановление</summary>
      {props.data?.sources.length === 0 ? <p className="mt-3 text-sm">Подтверждённых источников пока нет.</p> : null}
      <div className="mt-4 grid gap-5">{props.data?.sources.map(source => <SourceDecision key={`${source.id}:${String(source.revision)}`} source={source} busy={props.busy} onSubmit={props.onReconcile} onMessage={props.onMessage} />)}</div>
    </details>
    <details><summary className="cursor-pointer font-semibold">События Tribute для сверки</summary>
      <p className="mt-3 text-sm">Повторная проверка не выбирает произвольную версию конфликта. Подтвердите состояние в поддерживаемом источнике; ошибочную запись можно отклонить с причиной. Это не отзывает оплаченный остаток.</p>
      <div className="mt-4 grid gap-5">{props.data?.inbox.map(event => <form key={`${event.id}:${String(event.revision)}`} className="grid gap-3 border-b border-border pb-4" onSubmit={onAdminSubmit(form => {
        const parsed = retryTributeInboxSchema.omit({ operationId: true }).safeParse({ inboxId: event.id, expectedRevision: event.revision, action: formText(form.get("action")), reason: formText(form.get("reason")) });
        if (parsed.success) props.onInbox(parsed.data); else props.onMessage("Укажите решение и причину разбора события.");
      })}>
        <p className="break-all text-sm">{event.id}</p><p className="text-sm">{event.state} · {event.reason} · {event.updatedAt}</p>
        {event.state === "pending_reconciliation" || event.state === "received" ? <><AdminSelect label="Решение по событию" name="action" options={[{ value: "retry", label: "Повторить проверку" }, { value: "reject", label: "Отклонить ошибочную запись" }]} /><AdminField name="reason" label="Основание решения" required maxLength={1000} /><Button disabled={props.busy} type="submit">Сохранить решение</Button></> : null}
      </form>)}</div>
    </details>
  </AdminSection>;
}
function SourceDecision({ source, busy, onSubmit, onMessage }: { readonly source: Data["sources"][number]; readonly busy: boolean; readonly onSubmit: Props["onReconcile"]; readonly onMessage: Props["onMessage"] }) {
  return <details className="border-b border-border pb-4"><summary className="cursor-pointer break-words text-sm font-semibold">{source.state.tier.name} · {sourceLabels[source.status]} · {source.identityRef}</summary><form className="mt-4 grid gap-3" onSubmit={onAdminSubmit(form => {
    const action = formText(form.get("action"));
    const parsed = z.strictObject(reconcileTributeSchema.shape).omit({ operationId: true }).safeParse({ sourceId: source.id, expectedRevision: source.revision, action, reason: formText(form.get("reason")),
      ...(action === "restore" ? { confirmedTerms: { startsAt: formText(form.get("startsAt")), endsAt: formText(form.get("endsAt")), verificationRef: formText(form.get("verificationRef")) } } : {}) });
    if (parsed.success && (parsed.data.action !== "restore" || (parsed.data.confirmedTerms !== undefined && parsed.data.confirmedTerms.endsAt > parsed.data.confirmedTerms.startsAt))) onSubmit(parsed.data); else onMessage("Проверьте решение, причину и подтверждённые даты восстановления.");
  })}>
    <p className="font-semibold">{source.state.tier.name} · {sourceLabels[source.status]}</p>
    <p className="break-all text-sm">Источник {source.policyRef} · identity {source.identityRef} · версия {source.revision}</p>
    <p className="text-sm">{source.state.startsAt} → {source.state.endsAt}. Проверено: {source.checkedAt}. Продление Tribute: {source.state.renewal === "stopped" ? "остановлено" : source.state.renewal === "enabled" ? "включено" : "неизвестно"}.</p>
    <AdminSelect label="Решение по источнику" name="action" options={[{ value: "retry", label: "Повторить сопоставление аккаунта" }, { value: "revoke", label: "Отозвать это основание" }, { value: "restore", label: "Восстановить с подтверждённым периодом" }]} />
    <details><summary className="cursor-pointer text-sm">Подтверждение для восстановления</summary><div className="mt-3 grid gap-3"><AdminField name="startsAt" label="Подтверждённое начало" hint={dateHint} /><AdminField name="endsAt" label="Подтверждённый конец" hint={dateHint} /><AdminField name="verificationRef" label="Ссылка на подтверждение периода" /></div></details>
    <AdminField name="reason" label="Основание решения" required maxLength={1000} /><Button type="submit" disabled={busy}>Сохранить решение по источнику</Button>
  </form></details>;
}
