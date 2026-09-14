import Link from "next/link";
import { enrollmentSourceLabels, enrollmentStateLabels, type Enrollment } from "../model/enrollment";
import { formatBillingDate } from "../model/presentation";
export function EnrollmentList({ items }: { readonly items: readonly Enrollment[] }) {
  const groups = Map.groupBy(items, item => JSON.stringify([item.tier.benefits.toSorted(), item.tier.contentScope.guideIds.toSorted(), item.tier.contentScope.materialIds.toSorted()]));
  return <div className="grid gap-5">{items.length === 0 ? <p className="text-muted-foreground">Назначенных тарифов пока нет. Разовые покупки сохраняются в разделе «Покупки».</p> : [...groups.entries()].map(([key, group]) => <section key={key} className="grid gap-5">{group.length > 1 ? <h2 className="font-semibold">Одинаковый состав · {group.length} основания</h2> : null}{group.map((item, index) =>
    <article key={item.id} className="grid gap-3 border-b border-border pb-5 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-lg font-semibold">{item.tier.name}</h3><span className="text-sm">{enrollmentStateLabels[item.state]}</span></div>
      <p className="text-sm text-muted-foreground">{item.origin === "tribute" && item.endPolicy === "temporary_membership" ? "Временный доступ · срок Tribute уточняется" : enrollmentSourceLabels[item.origin]}</p>
      {item.state === "pending_verification" ? <p className="text-sm">Ожидаем актуальное подтверждение источника. Если проверка не завершается, обратитесь в поддержку. Другие приобретённые права сохраняются.</p> : null}
      {item.state === "suspended_source" ? <p className="text-sm">Источник больше не подтверждает доступ. Для восстановления требуется проверка поддержкой; повторное вступление само по себе доступ не возвращает. Другие приобретённые права сохраняются.</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"><dt>Начало</dt><dd>{formatBillingDate(item.startsAt)}</dd>
        <dt>Срок</dt><dd>{item.endsAt === null ? "Без даты окончания" : `До ${formatBillingDate(item.endsAt)}`}</dd>
        <dt>Материалы</dt><dd>Руководства: {item.tier.contentScope.guideIds.length}; отдельные материалы: {item.tier.contentScope.materialIds.length}</dd>
        <dt>Поддержка</dt><dd>{item.tier.benefits.includes("support") ? "Входит" : "Не входит"}</dd>
        <dt>Разборы</dt><dd>{item.tier.benefits.includes("reviews") ? "Входят" : "Не входят"}</dd>
        <dt>Сообщество</dt><dd>{item.tier.benefits.includes("community") ? "Входит в тариф" : "Не входит в тариф"}</dd>
        <dt>Списания Inside</dt><dd>{item.origin === "platform_payment" ? "Условия оплаты — в разделе «Покупки»" : "Следующего списания нет"}</dd>
      </dl>
      {item.benefitTerms && item.origin === "platform_payment" ? <ul className="grid gap-1 text-sm">{item.benefitTerms.map(term => <li key={`${benefitLabel(term.capability)}:${term.startsAt}`}>{benefitLabel(term.capability)}: {term.revoked ? "отозвано" : term.endsAt === null ? "без даты окончания" : `до ${formatBillingDate(term.endsAt)}`}</li>)}</ul> : null}
      {item.content && index === 0 ? <details><summary className="cursor-pointer text-sm font-medium">Посмотреть состав</summary><ul className="mt-3 grid gap-2 text-sm">{item.content.map(entry => <li key={`${entry.kind}:${entry.id}`}>{entry.slug !== null && entry.available ? <Link className="underline underline-offset-4" href={`/${entry.kind === "guide" ? "guides" : "materials"}/${encodeURIComponent(entry.slug)}`}>{entry.title}</Link> : <span>{entry.title} · временно недоступно</span>}</li>)}</ul></details> : null}
      {item.history ? <details><summary className="cursor-pointer text-sm font-medium">История назначения</summary><ul className="mt-3 grid gap-2 text-sm">{item.history.map((entry, index) => <li key={`${entry.recordedAt}:${String(index)}`}>{formatBillingDate(entry.recordedAt)} · {entry.reason}</li>)}</ul></details> : null}
      {item.tier.benefits.includes("community") ? <p className="text-xs leading-5 text-muted-foreground">Участие в сообществе также зависит от правил модерации. Тариф сохраняет право на материалы.</p> : null}
    </article>)}</section>)}</div>;
}

function benefitLabel(capability: string): string { switch (capability) { case "materials": return "Материалы"; case "community": return "Сообщество"; case "support": return "Поддержка"; case "reviews": return "Разборы"; default: return capability; } }
