"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const slotId = "application-announcement";

/**
 * Место над шапкой публичной оболочки. Пусто, пока страница не поставит туда объявление через
 * `ApplicationAnnouncement`; на широком экране оболочка занимает ровно экран, и место берёт свою
 * высоту у области содержания.
 */
export function ApplicationAnnouncementSlot() {
  return <div id={slotId} className="shrink-0" data-application-announcement />;
}

// Место — часть оболочки и не меняется, пока она на экране: подписываться не на что.
const subscribe = () => () => undefined;
const readSlot = () => document.getElementById(slotId);
const serverSlot = () => null;

/**
 * Объявление страницы над шапкой (решение владельца 23.11.2026: скидка над страницей курса).
 * Сервер его не рисует: место находится только в браузере, после гидратации. Портал остаётся
 * частью страницы, поэтому маршрут, скрытый для возврата (#2383), прячет и объявление, а
 * ушедший маршрут его убирает.
 */
export function ApplicationAnnouncement({
  children,
}: {
  readonly children: ReactNode;
}) {
  const slot = useSyncExternalStore(subscribe, readSlot, serverSlot);
  return slot === null ? null : createPortal(children, slot);
}
