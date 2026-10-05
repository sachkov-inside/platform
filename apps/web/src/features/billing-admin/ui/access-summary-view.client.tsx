"use client";
import { formatKopecks } from "@/entities/subscription";
import { hasText } from "@/shared/lib/text";

import {
  accessSourceLabel,
  lastMoscowDay,
  summaryMonthLabel,
  type AccessSummary,
} from "../model/access-operations";
import { AdminSection } from "./admin-form.client";

export interface AccessSummaryViewProps {
  readonly summary: AccessSummary | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "Europe/Moscow",
});
const momentFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

const cell = "px-3 py-2 text-left align-top";
const number = "px-3 py-2 text-right tabular-nums";

/**
 * Сводка доступа: сколько людей в каждом Offer и курсе, как работают приглашения, кому нужно
 * внимание владельца и сколько денег пришло и вернулось.
 */
export function AccessSummaryView(props: AccessSummaryViewProps) {
  if (props.loading) return <p role="status">Считаем сводку…</p>;
  if (hasText(props.error) || props.summary === null)
    return (
      <p
        className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm"
        role="alert"
      >
        {props.error ?? "Сводка недоступна."}
      </p>
    );
  const { summary } = props;
  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">
        На {momentFormat.format(new Date(summary.asOf))} по Москве.
      </p>
      <AdminSection
        title="Активные"
        description="Люди с действующим доступом. Платные — оплата, Tribute и разовая покупка; подарочные — приглашение и решение владельца."
      >
        {summary.active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Действующего доступа пока нет.
          </p>
        ) : (
          <div
            aria-label="Таблица активных"
            className="overflow-x-auto"
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-md text-sm">
              <caption className="sr-only">Активные по Offer и курсу</caption>
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className={cell} scope="col">
                    Offer
                  </th>
                  <th className={number} scope="col">
                    Платные
                  </th>
                  <th className={number} scope="col">
                    Подарочные
                  </th>
                  <th className={number} scope="col">
                    Курс
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.active.map((row) => (
                  <tr className="border-b border-border" key={row.offerId}>
                    <th className={cell} scope="row">
                      {row.name}
                    </th>
                    <td className={number}>{row.paid}</td>
                    <td className={number}>{row.gift}</td>
                    <td className={number}>{row.course}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>
      <AdminSection
        title="Приглашения"
        description="За всё время. «Оплатили» — купили этот Offer после погашения приглашения."
      >
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Выдано", summary.invitations.issued],
            ["Открыто", summary.invitations.opened],
            ["Оплата открыта", summary.invitations.purchaseOpened],
            ["Оплатили", summary.invitations.paid],
            ["Подарено", summary.invitations.gifted],
            ["Сгорело", summary.invitations.expired],
            ["Отозвано", summary.invitations.revoked],
          ].map(([label, value]) => (
            <div
              className="grid gap-1 rounded-xl border border-border p-3"
              key={label}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </AdminSection>
      <AdminSection
        title="Требуют внимания"
        description="Доступ кончается в ближайшие 7 дней или списание не прошло за последние 7 дней."
      >
        {summary.attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Никому не нужно внимание.
          </p>
        ) : (
          <ul aria-label="Требуют внимания" className="grid gap-2 text-sm">
            {summary.attention.map((row) => (
              <li
                className="grid min-w-0 gap-1 rounded-xl border border-border p-3"
                key={`${row.reason}:${row.accountId}:${row.at}`}
              >
                <span className="font-semibold">
                  {row.reason === "ending"
                    ? `Доступ до ${dateFormat.format(new Date(`${lastMoscowDay(row.at)}T12:00:00+03:00`))} включительно`
                    : `Списание не прошло ${momentFormat.format(new Date(row.at))}`}
                </span>
                <span>
                  {row.title}
                  {row.source === null
                    ? ""
                    : ` · ${accessSourceLabel(row.source)}`}
                </span>
                <span className="break-all font-mono text-xs text-muted-foreground">
                  {row.accountId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
      <AdminSection
        title="Выручка и возвраты"
        description="Подтверждённые банком оплаты и возвраты по месяцам по Москве за последние 12 месяцев."
      >
        {summary.revenue.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            За 12 месяцев оплат не было.
          </p>
        ) : (
          <div
            aria-label="Таблица выручки"
            className="overflow-x-auto"
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-xl text-sm">
              <caption className="sr-only">
                Выручка и возвраты по месяцам и Offer
              </caption>
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className={cell} scope="col">
                    Месяц
                  </th>
                  <th className={cell} scope="col">
                    Offer
                  </th>
                  <th className={number} scope="col">
                    Оплаты
                  </th>
                  <th className={number} scope="col">
                    Выручка
                  </th>
                  <th className={number} scope="col">
                    Возвраты
                  </th>
                  <th className={number} scope="col">
                    Возвращено
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.revenue.map((row) => (
                  <tr
                    className="border-b border-border"
                    key={`${row.month}:${row.offerId}`}
                  >
                    <td className={cell}>{summaryMonthLabel(row.month)}</td>
                    <th className={cell} scope="row">
                      {row.name}
                    </th>
                    <td className={number}>{row.payments}</td>
                    <td className={number}>
                      {formatKopecks(row.revenueKopecks)}
                    </td>
                    <td className={number}>{row.refunds}</td>
                    <td className={number}>
                      {formatKopecks(row.refundedKopecks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>
    </div>
  );
}
