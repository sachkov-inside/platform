import {
  capabilitiesOpening,
  type Coverage,
} from "@inside/access-capabilities";
import { accessComposition, isProductCapability } from "./billing-contract";
import type {
  AccessCapability,
  AccessSource,
  AttemptKind,
  AttemptState,
  BillingFailureCode,
  BillingOffer,
  BillingPaymentOption,
  NoticeKind,
  PriceSnapshot,
  RetirementReason,
} from "./billing-contract";

const moscow = "Europe/Moscow";

/** Точная сумма из снимка сервера: копейки показываются только когда они есть. */
export function formatKopecks(kopecks: number): string {
  const fraction = kopecks % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(kopecks / 100);
}

/** Даты подписки живут в календаре продавца, поэтому браузерный часовой пояс их не сдвигает. */
export function formatBillingDate(instant: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: moscow,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(instant));
}

export function formatBillingDateTime(instant: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: moscow,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));
}

/** Одна, две–четыре и пять и больше: русское число выбирает форму по двум последним цифрам. */
function pluralize(
  count: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const tail = count % 100;
  const last = count % 10;
  const form =
    tail > 10 && tail < 20
      ? forms[2]
      : last === 1
        ? forms[0]
        : last > 1 && last < 5
          ? forms[1]
          : forms[2];
  return `${String(count)} ${form}`;
}

export function formatMonths(months: number): string {
  return pluralize(months, ["месяц", "месяца", "месяцев"]);
}

export function formatYears(years: number): string {
  return pluralize(years, ["год", "года", "лет"]);
}

/** Срок предложения словами: целые годы называются годами, остальное — месяцами. */
export function formatTermMonths(months: number): string {
  return months % 12 === 0 ? formatYears(months / 12) : formatMonths(months);
}

/**
 * Состав доступа описывается независимыми правами предложения, а не названием тарифа.
 * Неизвестное право не выдумывается: показывается его точный идентификатор.
 */
export function capabilityLabel(capability: AccessCapability): string {
  switch (capability) {
    case "materials":
      return "Все опубликованные материалы и продукты";
    case "support":
      return "Вопросы автору и эфиры";
    case "community":
      return "Сообщество продукта";
    case "reviews":
      return "Разборы работ";
    default:
      // В закрытом наборе остаётся только право на конкретное руководство.
      return "Отдельный продукт";
  }
}

export interface BenefitLine {
  readonly capability: AccessCapability;
  readonly label: string;
  /** `null`, когда право не ограничено сроком: кабинет и сводки такой срок не называют. */
  readonly term: string | null;
}

/**
 * Самый долгий из сроков, которыми держится одно право: неуказанный срок означает право без даты
 * окончания и побеждает любой другой. Так же объединяет основания сервер, когда их несколько.
 * Набор непустой: его собирают из прав, которые уже нашлись в составе предложения; вызывающая
 * сторона пустой набор сюда не передаёт.
 */
export function longestTerm(terms: readonly (number | null)[]): number | null {
  let longest = 0;
  for (const term of terms) {
    if (term === null) return null;
    longest = Math.max(longest, term);
  }
  return longest;
}

/**
 * Как назвать состав тарифа одной строкой: все продукты платформы или число выбранных продуктов.
 */
export function coverageSummary(
  scope: Pick<Coverage, "productIds" | "wholePlatform">,
): string {
  return scope.wholePlatform === true
    ? "Все продукты платформы, включая новые"
    : `Продукты: ${String(scope.productIds.length)}`;
}

/**
 * Срок конкретного права может отличаться от периода списания: у подписки неуказанный срок
 * наследует период варианта оплаты, у разовой покупки такого периода нет и право выдаётся без
 * даты окончания. Явный `null` означает то же в обоих случаях. Договорный срок разовой покупки называет
 * страница оплаты по срокам предложения (оферта, редакция 5), поэтому кабинет и сводки прав такой срок не называют — ни «бессрочно», ни
 * «без даты окончания»: `term` тогда `null`, и вызывающая сторона его не показывает. Сообщество продукта,
 * который открывают сами руководства предложения, живёт их сроком: даже когда чат объявлен
 * составом отдельно и на более короткий срок, участие держится дольше. Так же объединяет основания
 * сервер — с той разницей, что он смотрит на все действующие права Account, а предложение отвечает
 * только за свой состав.
 */
export function benefitLines(conditions: {
  readonly offer: BillingOffer;
  readonly paymentOption: BillingPaymentOption;
}): readonly BenefitLine[] {
  return benefitTerms(conditions).map(({ capability, months }) => ({
    capability,
    label: capabilityLabel(capability),
    term: months === null ? null : formatMonths(months),
  }));
}

/** Срок одного права предложения в месяцах; `null` — право без даты окончания. */
export interface BenefitTerm {
  readonly capability: AccessCapability;
  readonly months: number | null;
}

/** Те же сроки, что называет `benefitLines`, числами: по ним оплата показывает сроки предложения. */
export function benefitTerms(conditions: {
  readonly offer: BillingOffer;
  readonly paymentOption: BillingPaymentOption;
}): readonly BenefitTerm[] {
  const { offer, paymentOption } = conditions;
  const months = (capability: AccessCapability): number | null => {
    const period = offer.benefitPeriods?.find(
      (entry) => entry.capability === capability,
    );
    if (period !== undefined) return period.months;
    return paymentOption.mode === "one_time" ? null : paymentOption.months;
  };
  // Чат держится всем, что его открывает. Какие именно права это делают, отвечает владелец
  // правила: иначе второй способ открыть чат пришлось бы дописывать и здесь.
  const communityTerms = capabilitiesOpening("community", offer.benefits).map(
    months,
  );
  return accessComposition(offer.benefits).map((capability) => ({
    capability,
    months:
      capability === "community"
        ? longestTerm(communityTerms)
        : months(capability),
  }));
}

/**
 * Чем открыто основание. Оплатой открывается и подписка, и отдельно купленное руководство,
 * поэтому основание названо доступом. Ручная выдача названа выдачей: покупкой она не является,
 * даже когда открывает тот же состав.
 */
export function accessSourceLabel(source: AccessSource): string {
  switch (source) {
    case "paid":
      // Оплатой открывается и подписка, и отдельно купленное руководство.
      return "Оплаченный доступ";
    case "manual":
      return "Выдано вручную";
    case "legacy":
      return "Ранее полученный доступ";
    case "course_activation":
      return "Активация курса";
    case "unknown":
      return "Источник не уточнён";
  }
}

/**
 * Что именно оплачено. Разовая покупка названа покупкой: периода списания у неё нет, и
 * показывать срок варианта оплаты было бы неправдой.
 */
export function paymentSubjectLabel(payment: {
  readonly kind: AttemptKind;
  readonly months: number;
}): string {
  return payment.kind === "one_time"
    ? "разовая покупка"
    : formatMonths(payment.months);
}

/**
 * Как назвать состав предложения покупателю. Руководство с сопровождением называется именно так,
 * а не просто руководством: покупатель должен видеть, за что платит. Сообщество продукта назван и тогда,
 * когда его открывает само руководство, а не отдельное право в составе предложения.
 */
export function offerCompositionLabel(offer: BillingOffer): string {
  // Каждая часть названа дважды: сама по себе и после предлога. Русский требует творительного
  // падежа, а склеивать его из именительного нечем — поэтому обе формы написаны, а не выведены.
  const parts: { readonly alone: string; readonly after: string }[] = [];
  const benefits = accessComposition(offer.benefits);
  if (benefits.some(isProductCapability)) {
    parts.push({ alone: "Продукт", after: "продуктом" });
  }
  if (benefits.includes("materials")) {
    parts.push({ alone: "Все материалы", after: "всеми материалами" });
  }
  if (benefits.includes("support")) {
    parts.push({ alone: "Сопровождение", after: "сопровождением" });
  }
  if (benefits.includes("community")) {
    parts.push({ alone: "Сообщество продукта", after: "сообществом продукта" });
  }
  const [first, ...rest] = parts;
  if (first === undefined) return offer.name;
  if (rest.length === 0) return first.alone;
  // Перечисление разделяется запятыми, и только последняя часть присоединяется союзом.
  const last = rest[rest.length - 1];
  const head = rest.slice(0, -1).map((part) => part.after);
  const tail = last === undefined ? "" : last.after;
  const listed = head.length === 0 ? tail : `${head.join(", ")} и ${tail}`;
  // Перед стечением согласных предлог удлиняется: «со всеми», но «с сопровождением».
  const preposition = listed.startsWith("всеми") ? "со" : "с";
  return `${first.alone} ${preposition} ${listed}`;
}

/** Банковское состояние попытки отделено от готовности доступа. */
export function attemptStateLabel(state: AttemptState): string {
  switch (state) {
    case "prepared":
      return "Готовим оплату";
    case "sent":
    case "pending":
      return "Ждём оплату";
    case "unknown":
      return "Результат ещё неизвестен";
    case "authorized":
      return "Банк удержал сумму";
    case "confirmed":
      return "Оплата подтверждена";
    case "failed":
      return "Оплата не прошла";
  }
}

export function noticeLabel(kind: NoticeKind): string {
  switch (kind) {
    case "renewal_reminder":
      return "Напоминание о списании";
    case "payment_succeeded":
      return "Платёж подтверждён";
    case "payment_failed":
      return "Списание не прошло";
    case "renewal_cancelled":
      return "Продление отменено";
    case "access_expired":
      return "Оплаченный срок закончился";
    case "refund_resolved":
      return "Возврат выполнен";
  }
}

/**
 * Полная цена рядом с ценой личной ссылки: оферта велит показать её до оплаты, когда ссылка дала
 * скидку. `null`, если это не ссылка или цена по ссылке не ниже полной.
 */
export function paymentLinkRegularPrice(
  snapshot: PriceSnapshot,
): number | null {
  const base = snapshot.individualPayment?.basePriceKopecks;
  return base !== undefined && base > snapshot.firstPriceKopecks ? base : null;
}

export function promotionLabel(snapshot: PriceSnapshot): string | undefined {
  return snapshot.promotion === null
    ? undefined
    : `${snapshot.promotion.name} · −${String(snapshot.promotion.percent)}%`;
}

/**
 * Причина, по которой сервер снял покупку до оплаты. Четыре причины снимают покупку до Init.
 * `form_address_lost` снимает её после Init: у Inside нет адреса формы оплаты, а банк назвал
 * форму неоплаченной (#1926). В обоих случаях деньги не списаны, и текст говорит об этом.
 */
export function purchaseRetirementMessage(reason: RetirementReason): string {
  switch (reason) {
    case "sale_closed":
      return "Продажа этого продукта закрыта. Покупка остановлена до оплаты, деньги не списаны.";
    case "price_unavailable":
      return "Цена этого продукта сейчас недоступна. Покупка остановлена до оплаты, деньги не списаны.";
    case "already_owned":
      return "Этот продукт у вас уже открыт. Покупка остановлена до оплаты, деньги не списаны.";
    case "unsupported_attempt":
      return "Покупка была начата на прежних условиях. Она остановлена до оплаты, деньги не списаны.";
    case "form_address_lost":
      return "Страница оплаты не открылась, поэтому мы остановили эту попытку. Деньги не списаны, можно купить снова.";
  }
}

/**
 * Ожидаемые исходы billing объясняются покупателю его словами. Повтор безопасен там, где
 * сервер сам восстанавливает начатую операцию, поэтому это сказано прямо.
 */
export function billingErrorMessage(code: BillingFailureCode): string {
  switch (code) {
    case "contact_required":
      return "Подтвердите почту для чеков, чтобы перейти к оплате.";
    case "consent_required":
      return "Условия покупки не приняты. Обновите страницу и нажмите кнопку оплаты снова.";
    case "document_changed":
      return "Условия покупки обновились. Прочитайте их и нажмите кнопку оплаты снова.";
    case "existing_access":
      return "Вы уже получили этот продукт. Повторная покупка недоступна.";
    case "legacy_review_required":
      return "Оплаченный заказ требует проверки. Обратитесь в поддержку.";
    case "not_eligible":
      return "Это предложение недоступно.";
    case "quote_expired":
      return "Условия оплаты устарели. Обновите их и попробуйте ещё раз.";
    case "quote_changed":
      return "Цена или состав изменились. Проверьте новые условия перед оплатой.";
    case "payment_in_progress":
      return "Оплата уже прошла или ещё выполняется. Проверьте раздел «Покупки» в кабинете. Не начинайте новую покупку.";
    case "refund_in_progress":
      return "Возврат по этому платежу ещё выполняется.";
    case "revision_conflict":
      return "Подписка изменилась. Обновите страницу и попробуйте ещё раз.";
    case "operation_conflict":
      return "Данные этого действия изменились. Обновите страницу и попробуйте ещё раз.";
    case "state_conflict":
      return "Сейчас это действие недоступно. Обновите страницу.";
    case "reservation_conflict":
      return "Скидка уже занята другой покупкой. Обновите условия.";
    case "preview_expired":
      return "Предпросмотр устарел. Соберите его заново.";
    case "identity_changed":
      return "Сопоставление изменилось после предпросмотра. Соберите его заново.";
    case "unsupported_amount":
      return "Эту сумму нельзя оплатить через банк.";
    case "method_unavailable":
      return "Способ оплаты сейчас недоступен.";
    case "provider_unavailable":
      return "Банк не отвечает. Попробуйте позже.";
    case "dependency_unavailable":
    case "unavailable":
      return "Данные оплаты сейчас недоступны. Повторите позже.";
    case "unauthorized":
      return "Сессия завершилась. Войдите снова.";
    case "forbidden":
      return "У вас нет права на это действие.";
    case "not_found":
      return "Операция не найдена. Проверьте раздел «Покупки» в кабинете.";
    case "invalid_request":
      return "Проверьте выбранные условия и повторите.";
  }
}
