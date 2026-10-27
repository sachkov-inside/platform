import type { BillingFailureCode } from "@/entities/subscription";

/**
 * Что владелец видит после действия с доступом (#1721). Правила решает Product Access; здесь
 * только подписи его ответов для карточки человека. Итог выдачи называет общий
 * `issueOutcomeMessage` из `@/entities/subscription`; его же возьмёт массовая выдача #1718.
 */

export function revokedMessage(productName: string): string {
  return `Доступ к «${productName}» отозван.`;
}

export function restoredMessage(productName: string): string {
  return `Доступ к «${productName}» восстановлен.`;
}

/**
 * Отказ, который не требует обновить карточку. `revision_conflict` сюда не попадает: его
 * показывает карточка вместе с кнопкой «Обновить данные».
 */
export function accessFailureMessage(code: BillingFailureCode): string {
  if (code === "operation_conflict")
    return "Этот запрос уже был отправлен с другими данными. Мы подготовили новый: повторите действие.";
  if (code === "unauthorized")
    return "Сессия завершилась. Войдите снова и повторите действие.";
  if (code === "forbidden")
    return "У аккаунта нет права управлять доступом к продуктам.";
  if (code === "not_found")
    return "Человек или продукт больше не найден. Обновите данные.";
  if (code === "invalid_request")
    return "Сервер не принял данные действия. Проверьте причину и повторите.";
  // Остальные коды принадлежат оплате, а не доступу: для владельца это сбой сервиса.
  return "Доступ сейчас не изменить: сервис не ответил. Ничего не изменилось, повторите позже.";
}

/** Ответ о доступе устарел: действие не выполнено, карточку нужно перечитать. */
export function isStaleAccess(code: BillingFailureCode): boolean {
  return code === "revision_conflict";
}
