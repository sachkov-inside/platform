/** Подтверждения терминала, от которых зависит продажа подписки. */
export interface SubscriptionTerminal {
  readonly recurringCardConfirmed: boolean;
  readonly cardOnlyHostedConfirmed: boolean;
}

/**
 * Что процесс вправе продавать. `payments` — есть терминал и адрес для чека; `subscriptions` —
 * ещё и оба подтверждения терминала. Рассчитывается из конфигурации процесса один раз.
 */
export interface SaleCapability {
  readonly payments: boolean;
  readonly subscriptions: boolean;
}

/**
 * Можно ли продавать подписку на этом терминале. Продление списывает по сохранённой привязке,
 * поэтому нужны оба подтверждения: автосписания по карте и форма только со способами, которые
 * такую привязку дают. Иначе первый платёж пройдёт, а продлить подписку будет нечем.
 */
export function subscriptionSaleConfirmed(
  terminal: SubscriptionTerminal,
): boolean {
  return terminal.recurringCardConfirmed && terminal.cardOnlyHostedConfirmed;
}

/** Что процесс вправе продавать при своём терминале и настроенном адресе для чека. */
export function saleCapability(
  terminal: SubscriptionTerminal | undefined,
  receiptContactConfigured: boolean,
): SaleCapability {
  const payments = terminal !== undefined && receiptContactConfigured;
  return {
    payments,
    subscriptions: payments && subscriptionSaleConfirmed(terminal),
  };
}
