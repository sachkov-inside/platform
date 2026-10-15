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

interface FactReaders {
  readonly callbacks: Set<(announcementId: string) => void>;
  readonly close: () => void;
}

const readersByChannel = new Map<string, FactReaders>();

/** One receiving transport per fact in this document; surfaces retain independent lifetimes. */
function subscribeFact(channelName: string, onAnnounced: (id: string) => void) {
  let readers = readersByChannel.get(channelName);
  if (readers === undefined) {
    const callbacks = new Set<(announcementId: string) => void>();
    const deliver = (value: unknown, legacy: boolean) => {
      const parsed = announcementIdSchema.safeParse(value);
      if (!parsed.success && !legacy) return;
      const identity = parsed.success ? parsed.data : crypto.randomUUID();
      for (const callback of callbacks) callback(identity);
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(channelName);
    if (channel === null) {
      const receive = (event: Event) => {
        deliver(
          event instanceof CustomEvent ? (event.detail as unknown) : undefined,
          true,
        );
      };
      if (typeof window !== "undefined")
        window.addEventListener(channelName, receive);
      readers = {
        callbacks,
        close: () => {
          if (typeof window !== "undefined")
            window.removeEventListener(channelName, receive);
        },
      };
    } else {
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        deliver(
          event.data,
          event.data === "written" || event.data === "changed",
        );
      });
      readers = {
        callbacks,
        close: () => {
          channel.close();
        },
      };
    }
    readersByChannel.set(channelName, readers);
  }
  const owned = readers;
  const receive = (id: string) => {
    onAnnounced(id);
  };
  owned.callbacks.add(receive);
  return () => {
    owned.callbacks.delete(receive);
    if (
      owned.callbacks.size === 0 &&
      readersByChannel.get(channelName) === owned
    ) {
      owned.close();
      readersByChannel.delete(channelName);
    }
  };
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
    subscribe: (onAnnounced) => subscribeFact(channelName, onAnnounced),
  };
}
