import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";

import { readBillingContact } from "../api/billing-contact.browser";

export const billingContactQueryKey = ["account", "billing-contact"] as const;

/**
 * Подтверждение адреса объявляется всем открытым поверхностям. Поверхность, где оно произошло,
 * сбрасывает свой ответ сама; остальным сбрасывать нечем: удачное чтение не перечитывается по
 * сроку, а два одновременно видимых окна не дают браузеру повода сообщить о возврате внимания.
 * Без объявления рядом с подтверждённым адресом остаётся запомненный ответ.
 */
const contactVerifiedChannelName = "inside.billing-contact.verified";

/** Сообщает другим открытым поверхностям, что контакт только что подтверждён. */
export function announceBillingContactVerified(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(contactVerifiedChannelName);
  channel.postMessage("verified");
  channel.close();
}

/** Подписка на подтверждение, случившееся на другой поверхности. Возвращает отписку. */
export function subscribeBillingContactVerified(
  onVerified: () => void,
): () => void {
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(contactVerifiedChannelName);
  channel?.addEventListener("message", () => {
    onVerified();
  });
  return () => {
    channel?.close();
  };
}

/**
 * Один владелец чтения контакта в браузере: разделы кабинета, витрина и форма читают тот же
 * ключ, поэтому подтверждённый адрес не расходится между ними.
 */
export function billingContactQueryOptions() {
  return {
    ...selfRefreshingRead,
    queryKey: billingContactQueryKey,
    queryFn: readBillingContact,
    refetchInterval: ({
      state,
    }: {
      readonly state: {
        readonly data: { readonly ok: boolean; readonly code?: string } | undefined;
      };
    }) =>
      state.data !== undefined && !state.data.ok && state.data.code !== "unauthorized"
        ? unavailableRetryIntervalMs
        : (false as const),
  };
}
