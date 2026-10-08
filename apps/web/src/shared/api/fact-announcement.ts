import { z } from "zod";

const announcementIdSchema = z.uuid();

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
   * начатому перечитыванию, а не начинать новое. Идентификатор одной записи одинаков у отправителя
   * и всех подписчиков; новая запись получает новый идентификатор.
   */
  readonly announce: () => string;
  /** Подписка на запись, объявленную любой поверхностью этого браузера. Возвращает отписку. */
  readonly subscribe: (
    onAnnounced: (announcementId: string) => void,
  ) => () => void;
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
      const announcementId = crypto.randomUUID();
      const channel = open();
      if (channel === null) {
        if (typeof window !== "undefined")
          window.dispatchEvent(
            new CustomEvent(channelName, { detail: announcementId }),
          );
        return announcementId;
      }
      channel.postMessage(announcementId);
      channel.close();
      return announcementId;
    },
    subscribe: (onAnnounced) => {
      const channel = open();
      if (channel === null) {
        const receive = (event: Event) => {
          const detail: unknown =
            event instanceof CustomEvent ? event.detail : undefined;
          const parsed = announcementIdSchema.safeParse(detail);
          // Ordinary window events from an older bundle still announce a write.
          onAnnounced(parsed.success ? parsed.data : crypto.randomUUID());
        };
        if (typeof window !== "undefined")
          window.addEventListener(channelName, receive);
        return () => {
          if (typeof window !== "undefined")
            window.removeEventListener(channelName, receive);
        };
      }
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        // Previous releases sent this literal; their open tabs keep working during an upgrade.
        if (event.data === "written" || event.data === "changed") {
          onAnnounced(crypto.randomUUID());
          return;
        }
        const parsed = announcementIdSchema.safeParse(event.data);
        if (parsed.success) onAnnounced(parsed.data);
      });
      return () => {
        channel.close();
      };
    },
  };
}
