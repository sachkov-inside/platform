/**
 * Страницы стенда и их ответы: здесь только то, что видит и нажимает человек. Решения банка
 * принимает соседний модуль, поэтому разметка ничего не меняет — ни в заказе, ни в журнале.
 */
import {
  bindingOutcomes, chargeOutcomes, paymentOutcomes, refundOutcomes,
  type BindingRecord, type ChargeOutcome, type OrderRecord, type RefundOutcome,
} from "./bank-double-state.js";

interface StandView {
  readonly terminalKey: string;
  readonly notificationUrl: string;
  readonly returnUrl: string;
  readonly orders: readonly OrderRecord[];
  readonly bindings: readonly BindingRecord[];
  readonly chargeOutcome: ChargeOutcome;
  readonly refundOutcome: RefundOutcome;
}

export function indexPage(view: StandView): string {
  const orders = view.orders.map(order => `<tr><td><a href="/pay/${order.paymentId}">${escapeHtml(order.description)}</a></td>
    <td>${money(order.amount)}</td><td>${escapeHtml(order.status)}</td><td>${escapeHtml(order.email)}</td>
    <td>${order.refundedKopecks === 0 ? "—" : money(order.refundedKopecks)}</td></tr>`).join("");
  const sessions = view.bindings.map(session => `<tr><td><a href="/card/${session.requestKey}">${session.requestKey}</a></td>
    <td>${escapeHtml(session.status)}</td></tr>`).join("");
  return `<h1>Двойник банка Inside</h1>
    <p class="note">Стенд без денег: терминал <b>${escapeHtml(view.terminalKey)}</b>, нотификации уходят на
    <code>${escapeHtml(view.notificationUrl)}</code>, возврат после формы — на <code>${escapeHtml(view.returnUrl)}</code>.</p>
    <form method="post" action="/control">
      <h2>Исход без формы</h2>
      <p>Списание по сохранённой карте и возврат происходят без участия покупателя, поэтому их
      исход выбирается заранее.</p>
      <label>Следующее списание
        <select name="chargeOutcome">${options(chargeOutcomes.map(key =>
          [key, paymentOutcomes[key].label] as const), view.chargeOutcome)}</select></label>
      <label>Возврат
        <select name="refundOutcome">${options(Object.entries(refundOutcomes), view.refundOutcome)}</select></label>
      <button type="submit">Сохранить</button>
    </form>
    <h2>Заказы</h2>
    ${orders ? `<table><tr><th>Заказ</th><th>Сумма</th><th>Статус</th><th>Чек</th><th>Возвращено</th></tr>${orders}</table>`
      : "<p class=\"note\">Пока ни одной оплаты.</p>"}
    <h2>Привязки карты</h2>
    ${sessions ? `<table><tr><th>Сессия</th><th>Статус</th></tr>${sessions}</table>`
      : "<p class=\"note\">Пока ни одной сессии привязки.</p>"}`;
}

export function paymentPage(order: OrderRecord): string {
  const buttons = Object.entries(paymentOutcomes).map(([key, outcome]) =>
    `<button type="submit" name="outcome" value="${key}">${outcome.label}</button>`).join("");
  // Повтор нотификации имеет смысл только после выбранного исхода: NEW повторять нечего.
  const repeat = order.status === "NEW" ? ""
    : "<button type=\"submit\" name=\"outcome\" value=\"repeat\">Повторить нотификацию</button>";
  return `<h1>${escapeHtml(order.description)}</h1>
    <p class="amount">${money(order.amount)}</p>
    <p class="note">Заказ ${escapeHtml(order.orderId)} · платёж ${escapeHtml(order.paymentId)} · статус ${escapeHtml(order.status)}
    ${order.recurrent ? "· покупатель разрешил сохранить карту" : ""}</p>
    <form method="post">${buttons}${repeat}</form>
    <p class="note"><a href="/">Ко всем заказам</a></p>`;
}

export function bindingPage(session: BindingRecord): string {
  const buttons = Object.entries(bindingOutcomes).map(([key, outcome]) =>
    `<button type="submit" name="outcome" value="${key}">${outcome.label}</button>`).join("");
  return `<h1>Привязка карты</h1>
    <p class="note">Сессия ${escapeHtml(session.requestKey)} · покупатель ${escapeHtml(session.customerKey)} · статус ${escapeHtml(session.status)}</p>
    <form method="post">${buttons}</form>
    <p class="note"><a href="/">Ко всем заказам</a></p>`;
}

export const missingPage = (message: string): string =>
  `<h1>${escapeHtml(message)}</h1><p class="note"><a href="/">Ко всем заказам</a></p>`;

export function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Двойник банка Inside</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:46rem;padding:1.5rem;color:#14213d}
h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem}.note{color:#5b6478;font-size:.9rem}
.amount{font-size:2rem;font-weight:700;margin:.25rem 0}table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #dfe3ec;padding:.5rem;text-align:left;font-size:.95rem}
button{margin:.25rem .5rem .25rem 0;padding:.6rem 1rem;border:1px solid #14213d;border-radius:.4rem;
background:#fff;cursor:pointer;font:inherit}button:hover{background:#eef1f8}
label{display:block;margin:.5rem 0}select{font:inherit;padding:.3rem;margin-left:.5rem}
a{color:#1b4dc1}</style></head><body>${body}</body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const money = (kopecks: number) => `${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ₽`;
const options = (values: readonly (readonly [string, string])[], selected: string) => values
  .map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
