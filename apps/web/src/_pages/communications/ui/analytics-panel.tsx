import { Button } from "@/shared/ui/button";
import { type StatisticsResult, type Funnel, type Entry, type Contact, errorMessage, deliveryLabels, type deliveryListSchema } from "../model/communications";
import type { z } from "zod";
export function AnalyticsPanel({ result, funnels, deliveries, onContact, onNextContacts, onNextDeliveries }: {
  readonly result: StatisticsResult | undefined; readonly funnels: readonly Funnel[];
  readonly deliveries: z.infer<typeof deliveryListSchema> | undefined;
  readonly onContact: (contact: Contact) => void; readonly onNextContacts: (cursor: string) => void; readonly onNextDeliveries: (cursor: string) => void;
}) {
  if (!result) return <p role="status">Загружаем аналитику…</p>;
  if (result.kind === "error") return <p role="alert">{errorMessage(result.code)}</p>;
  const { statistics: s, trackingBacklog } = result;
  const sourceName = (id: string | null) => id === null ? "Без источника" : funnels.flatMap(f => f.sources).find(source => source.sourceId === id)?.name ?? id;
  return <section className="mt-6 space-y-5" aria-label="Аналитика коммуникаций">
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries({ "Всего контактов": s.totalBotContacts, "Доступны боту": s.reachable, "Заблокировали бота": s.blocked, "Отключили сообщения": s.marketingOff, "Участники воронок": s.uniqueParticipants, "Отправлено частей": s.deliveries.sent, "Пропущено частей": s.deliveries.suppressed, "Ошибок отправки": s.deliveries.failed, "Неизвестных результатов": s.deliveries.unknown, "Ожидает частей": s.deliveries.pending, "Частично отменено доставок": s.deliveries.partialCancelled, "Переходов по ссылкам": s.trackingHits, "Уникальных ссылок с переходом": s.uniqueTokensWithHits, "Автоматических переходов": s.knownAutomationHits }).map(([label, value]) => <div className="rounded-lg border border-border p-3" key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></div>)}</dl>
    <p className="text-sm">Общие контакты и доступность относятся ко всему боту. Фильтр сужает участников, доставки, переходы и список контактов. Отправка не означает прочтение. Ссылку можно переслать: переход не доказывает личность читателя, вход в аккаунт или оплату.</p>
    <p role="status">{trackingBacklog.kind === "unavailable" ? "Задержка передачи переходов сейчас неизвестна; статистика может быть неполной." : `Ожидают передачи: ${String(trackingBacklog.pending)}. Возраст самого старого события: ${String(trackingBacklog.oldestAgeSeconds)} с.`} Максимальная задержка уже доставленных событий: {s.analyticsLagSeconds} с.</p>
    <h3 className="text-lg font-semibold">Контакты и источники входа</h3>
    {!s.contacts.length ? <p>Контактов пока нет.</p> : <ul className="space-y-3">{s.contacts.map(contact => <li key={contact.contactId} className="space-y-1 rounded-lg border border-border p-3"><p className="break-all font-mono text-xs">Контакт {contact.contactId}</p><p>{contact.reachable ? "Бот доступен" : "Бот недоступен"} · {contact.marketingEnabled ? "Сообщения включены" : "Сообщения отключены"}</p><p className="break-words">Первый источник: {sourceName(contact.firstSourceId)}</p><p className="break-words">Последний источник: {sourceName(contact.latestSourceId)}</p><Button variant="outline" onClick={() =>{  onContact(contact); }}>История входов</Button></li>)}</ul>}
    {s.nextCursor ? <Button variant="outline" onClick={() =>{  onNextContacts(s.nextCursor ?? ""); }}>Следующие контакты</Button> : null}
    <h3 className="text-lg font-semibold">Доставка и причины пропусков</h3>
    {!deliveries ? <p role="status">Загружаем доставки…</p> : deliveries.kind === "error" ? <p role="alert">{errorMessage(deliveries.code)}</p> : <>
      {!deliveries.deliveries.length ? <p>Доставок пока нет.</p> : <ul className="space-y-3">{deliveries.deliveries.map(delivery => <li key={delivery.deliveryId} className="rounded-lg border border-border p-3"><p className="break-all text-xs">Контакт {delivery.contactId}</p>{delivery.cancelRequested ? <p>Отмена запрошена; начатая отправка сохранит свой результат.</p> : null}<ul>{delivery.parts.map((part, i) => <li key={part.partId} className="break-words">Часть {i + 1}: {deliveryLabels[part.state]}{part.diagnosticCode ? ` · ${part.diagnosticCode}` : ""}</li>)}</ul></li>)}</ul>}
      {deliveries.nextCursor ? <Button variant="outline" onClick={() =>{  onNextDeliveries(deliveries.nextCursor ?? ""); }}>Следующие доставки</Button> : null}
    </>}
  </section>;
}
export function EntryHistory({ entries, funnels }: { readonly entries: readonly Entry[]; readonly funnels: readonly Funnel[] }) {
  const sources = funnels.flatMap(f => f.sources);
  return <ol className="space-y-2">{entries.map((entry, i) => <li key={i} className="break-words">{new Date(entry.enteredAt).toLocaleString("ru-RU")} · {sources.find(s => s.sourceId === entry.sourceId)?.name ?? entry.sourceCode ?? "Обычный вход"} · {entry.outcome}</li>)}</ol>;
}
