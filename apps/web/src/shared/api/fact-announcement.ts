/**
 * Объявление о записи браузерного факта всем открытым поверхностям одного браузера. Поверхность,
 * которая записала факт, обновляет свой ответ сама; остальным обновлять нечем: у удачного чтения
 * нет интервала обновления, а браузер сообщает о возврате внимания только сменой видимости
 * вкладки, которой между двумя одновременно видимыми окнами не бывает.
 *
 * Границы механизма: объявление живёт внутри одного браузера. Другое устройство им не сходится —
 * там нужен серверный толчок. Без `BroadcastChannel` событие `window` обновляет соседние
 * поверхности той же вкладки. Другие вкладки увидят запись при следующем перечитывании:
 * при открытии или возврате внимания, когда ответ в кеше уже устарел.
 */
export interface FactAnnouncement {
  /**
   * Сообщает открытым поверхностям, что факт только что записан. Слышат все подписки браузера,
   * включая подписки той же вкладки, поэтому повторный сброс там должен присоединяться к уже
   * начатому перечитыванию, а не начинать новое.
   */
  readonly announce: () => void;
  /** Подписка на запись, объявленную любой поверхностью этого браузера. Возвращает отписку. */
  readonly subscribe: (onAnnounced: () => void) => () => void;
}

/**
 * Объявление одного факта. Имя канала принадлежит фичи, которая владеет фактом: у двух фактов
 * не бывает общего имени, иначе запись одного сбрасывала бы чтение другого.
 */
export function factAnnouncement(channelName: string): FactAnnouncement {
  /** Канал этого документа или ничего там, где браузер его не даёт. */
  const open = (): BroadcastChannel | null =>
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(channelName);

  return {
    announce: () => {
      const channel = open();
      if (channel === null) {
        if (typeof window !== "undefined")
          window.dispatchEvent(new Event(channelName));
        return;
      }
      channel.postMessage("written");
      channel.close();
    },
    subscribe: (onAnnounced) => {
      const channel = open();
      if (channel === null) {
        if (typeof window !== "undefined")
          window.addEventListener(channelName, onAnnounced);
        return () => {
          if (typeof window !== "undefined")
            window.removeEventListener(channelName, onAnnounced);
        };
      }
      channel.addEventListener("message", onAnnounced);
      return () => {
        channel.close();
      };
    },
  };
}
