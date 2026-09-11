import type {
  AccessCapability,
  AccessSource,
  AttemptKind,
  AttemptState,
  BillingFailureCode,
  BillingOffer,
  NoticeKind,
  PaymentMode,
  PriceSnapshot,
  SubscriptionState,
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

export function formatMonths(months: number): string {
  const tail = months % 100;
  const last = months % 10;
  if (tail > 10 && tail < 20) return `${String(months)} месяцев`;
  if (last === 1) return `${String(months)} месяц`;
  if (last > 1 && last < 5) return `${String(months)} месяца`;
  return `${String(months)} месяцев`;
}

/**
 * Состав доступа описывается независимыми правами предложения, а не названием тарифа.
 * Неизвестное право не выдумывается: показывается его точный идентификатор.
 */
export function capabilityLabel(capability: AccessCapability): string {
  switch (capability) {
    case "materials":
      return "Все опубликованные материалы и руководства";
    case "support":
      return "Вопросы автору и эфиры";
    case "community":
      return "Общий чат";
    case "reviews":
      return "Разборы работ";
    default:
      // В закрытом наборе остаётся только право на конкретное руководство.
      return "Отдельное руководство";
  }
}

export interface BenefitLine {
  readonly capability: AccessCapability;
  readonly label: string;
  readonly term: string;
}

/**
 * Срок конкретного права может отличаться от периода списания: у подписки неуказанный срок
 * наследует период варианта оплаты, у разовой покупки такого периода нет и право бессрочно.
 * Явный `null` означает бессрочное право в обоих случаях.
 */
export function benefitLines(
  offer: BillingOffer,
  months: number,
  mode: PaymentMode = "subscription",
): readonly BenefitLine[] {
  return offer.benefits.map((capability) => {
    const period = offer.benefitPeriods?.find(
      (entry) => entry.capability === capability,
    );
    const term =
      period === undefined
        ? mode === "one_time"
          ? "бессрочно"
          : formatMonths(months)
        : period.months === null
          ? "бессрочно"
          : formatMonths(period.months);
    return { capability, label: capabilityLabel(capability), term };
  });
}

/**
 * Чем открыто основание. Ручная выдача названа выдачей: покупкой она не является, даже когда
 * открывает тот же состав.
 */
export function accessSourceLabel(source: AccessSource): string {
  switch (source) {
    case "paid":
      // Оплатой открывается и подписка, и отдельно купленное руководство.
      return "Оплаченный доступ";
    case "manual":
      return "Выдано вручную";
    case "legacy":
      return "Прежняя подписка";
  }
}

export function subscriptionStateLabel(state: SubscriptionState): string {
  switch (state) {
    case "active":
      return "Действует";
    case "canceled":
      return "Продление отменено";
    case "ended":
      return "Завершена";
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
      return "Решение по возврату";
  }
}

export function promotionLabel(snapshot: PriceSnapshot): string | undefined {
  return snapshot.promotion === null
    ? undefined
    : `${snapshot.promotion.name} · −${String(snapshot.promotion.percent)}%`;
}

/**
 * Ожидаемые исходы billing объясняются покупателю его словами. Повтор безопасен там, где
 * сервер сам восстанавливает начатую операцию, поэтому это сказано прямо.
 */
export function billingErrorMessage(code: BillingFailureCode): string {
  switch (code) {
    case "contact_required":
      return "Сначала подтвердите email для чеков: без него оплату принять нельзя.";
    case "consent_required":
      return "Отметьте требуемые условия в этой форме — без них оплату принять нельзя.";
    case "existing_access":
      return "У вас уже есть доступ к части этого состава. Подтвердите, что понимаете это, и продолжите.";
    case "legacy_review_required":
      return "Ваша прежняя подписка ещё не разобрана. Мы включим оплату после проверки — новое списание пока не начинаем.";
    case "quote_expired":
      return "Расчёт устарел. Обновите условия и повторите.";
    case "quote_changed":
      return "Цена или состав изменились. Проверьте новые условия перед оплатой.";
    case "payment_in_progress":
      return "Оплата уже прошла или ещё выполняется. Откройте платёжный кабинет — новую покупку начинать не нужно.";
    case "refund_in_progress":
      return "Возврат по этому платежу ещё выполняется.";
    case "revision_conflict":
      return "Подписка изменилась в другом месте. Обновите данные и повторите действие.";
    case "operation_conflict":
      return "Эта операция уже выполнена с другими данными. Обновите страницу и повторите.";
    case "state_conflict":
      return "Текущее состояние не допускает эту операцию.";
    case "reservation_conflict":
      return "Скидка уже занята другой покупкой. Обновите условия.";
    case "preview_expired":
      return "Предпросмотр устарел. Соберите его заново.";
    case "identity_changed":
      return "Сопоставление изменилось после предпросмотра. Соберите его заново.";
    case "unsupported_amount":
      return "Сумма вне подтверждённых границ терминала.";
    case "method_unavailable":
      return "Способ оплаты сейчас недоступен.";
    case "provider_unavailable":
      return "Банк сейчас не отвечает. Повторите позже — повторный запрос безопасен.";
    case "dependency_unavailable":
    case "unavailable":
      return "Данные оплаты сейчас недоступны. Повторите позже.";
    case "unauthorized":
    case "forbidden":
      return "Сессия завершилась. Войдите снова.";
    case "not_found":
      return "Мы не нашли эту операцию.";
    case "invalid_request":
      return "Проверьте выбранные условия и повторите.";
  }
}
