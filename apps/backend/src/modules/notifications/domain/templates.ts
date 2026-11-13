import type {
  NotificationSource,
  SaleBuyer,
  SaleFacts,
} from "../ports/notification-sources.js";
const subjects = {
  material_published: "Новый материал в Inside",
  renewal_reminder: "Скоро продление подписки Inside",
  access_ending: "Доступ Inside скоро закончится",
  payment_succeeded: "Оплата Inside подтверждена",
  payment_failed: "Оплата Inside не прошла",
  renewal_cancelled: "Продление Inside отменено",
  access_expired: "Доступ Inside закончился",
  refund_resolved: "Результат возврата Inside",
  sale_recorded: "Новая покупка",
} as const;
/** Авторы работают по московскому времени: снимок цены покупки тоже хранит Europe/Moscow. */
const moscowTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const oneLine = (value: string) => value.replaceAll(/[\r\n]+/gu, " ").trim();
function promotionLine(promotion: SaleFacts["promotion"]): string[] {
  if (promotion === null) return [];
  return promotion.code === null
    ? [`Скидка: ${oneLine(promotion.name)} (${String(promotion.percent)}%)`]
    : [
        `Промокод: ${oneLine(promotion.code)} (скидка ${String(promotion.percent)}%)`,
      ];
}
/** Telegram показывает `@username` ссылкой на профиль; чужой символ превращает его в простой текст. */
const telegramUsername = /^[A-Za-z0-9_]{4,32}$/u;
function buyerLine(buyer: SaleBuyer): string {
  if (buyer.state === "not_linked") return "Покупатель: Telegram не привязан";
  if (buyer.state === "unavailable")
    return "Покупатель: Telegram привязан, профиль не прочитан";
  const name =
    buyer.displayName === null ? "" : oneLine(buyer.displayName).slice(0, 129);
  const username =
    buyer.username !== null && telegramUsername.test(buyer.username)
      ? `@${buyer.username}`
      : null;
  if (name === "") return `Покупатель: ${username ?? "Telegram без имени"}`;
  return `Покупатель: ${name}, ${username ?? "без username"}`;
}
/** Петля не выходит наружу, поэтому стенд читается по http; любой другой узел обязан быть под TLS. */
function readerLinkAllowed(base: URL): boolean {
  return (
    base.protocol === "https:" ||
    (base.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname))
  );
}
export function renderNotification(
  source: Extract<NotificationSource, { status: "current" }>,
  origin: string,
) {
  const base = new URL(origin);
  const url = new URL(source.readerPath, base);
  if (
    !readerLinkAllowed(base) ||
    base.username !== "" ||
    base.password !== "" ||
    url.origin !== base.origin ||
    url.username !== "" ||
    url.password !== "" ||
    !source.readerPath.startsWith("/") ||
    source.readerPath.startsWith("//")
  )
    throw new Error("notification_link_invalid");
  const subject = subjects[source.content.kind];
  const amount =
    source.amountMinor === undefined
      ? ""
      : `\nСумма: ${(source.amountMinor / 100).toFixed(2)} ₽.`;
  if (
    source.amountMinor !== undefined &&
    (!Number.isSafeInteger(source.amountMinor) || source.amountMinor < 0)
  )
    throw new Error("notification_amount_invalid");
  const date =
    source.dueAt === undefined
      ? ""
      : `\nДата: ${new Date(source.dueAt).toISOString()}.`;
  const title = oneLine(source.title);
  if (title === "" || title.length > 1_500)
    throw new Error("notification_title_invalid");
  if (source.content.kind === "sale_recorded") {
    const sale = source.sale;
    if (sale?.buyer === undefined || source.amountMinor === undefined)
      throw new Error("notification_sale_invalid");
    return {
      templateRef: `inside.${source.content.kind}`,
      templateRevision: 2,
      subject,
      text: [
        subject,
        "",
        `Продукт: ${title}`,
        `Сумма: ${(source.amountMinor / 100).toFixed(2)} ₽`,
        ...promotionLine(sale.promotion),
        `Время: ${moscowTime.format(new Date(source.event.occurredAt))} по Москве`,
        buyerLine(sale.buyer),
        "",
        url.href,
      ].join("\n"),
    };
  }
  return {
    templateRef: `inside.${source.content.kind}`,
    templateRevision: 1,
    subject,
    text: `${subject}\n\n${title}${amount}${date}\n\n${url.href}`,
  };
}
