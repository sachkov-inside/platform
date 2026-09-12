/**
 * Подтверждение адреса объявляется всем открытым поверхностям одного браузера. Поверхность, где
 * подтверждение произошло, сбрасывает свой ответ сама; остальным сбрасывать нечем: у удачного
 * чтения нет интервала обновления, а браузер сообщает о возврате внимания только сменой
 * видимости вкладки, которой между двумя одновременно видимыми окнами не бывает.
 *
 * Границы механизма: объявление живёт внутри одного браузера. Другое устройство им не сходится —
 * там нужен серверный толчок. Браузер без `BroadcastChannel` остаётся на прежнем поведении:
 * подтвердившая поверхность обновится сама, соседняя — при следующем открытии.
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
