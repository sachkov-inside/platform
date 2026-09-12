import {
  defaultGuideMode,
  guideModeLabels,
  guideModes,
  guideModeSchema,
  isGuideMode,
} from "@inside/material-blocks";
import type { GuideMode } from "@inside/material-blocks";

export {
  defaultGuideMode,
  guideModeLabels,
  guideModes,
  guideModeSchema,
  isGuideMode,
  type GuideMode,
};

/**
 * Режим гостя держится в браузере. Это cookie, а не localStorage: страницу урока рисует сервер, и
 * без cookie он не знал бы, какой вариант показать, — читатель увидел бы чужой вариант и подмену
 * сразу после загрузки. Вошедшему читателю cookie не пишется: его режим хранится за ним, и
 * гостевое значение не должно попасть в аккаунт.
 */
export const GUEST_GUIDE_MODE_COOKIE = "inside.guide-mode";

/** Год: выбор режима — это настройка чтения, а не сеанс. */
const GUEST_GUIDE_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Запоминает выбор гостя в этом браузере. Недоступная cookie меняет только память между входами,
 * а не текущий урок, поэтому отказ здесь молчаливый.
 */
export function rememberGuestGuideMode(mode: GuideMode): void {
  try {
    // На площадке cookie не должна уходить по открытому протоколу; на локальном http его нет.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${GUEST_GUIDE_MODE_COOKIE}=${mode}; path=/; max-age=${String(GUEST_GUIDE_MODE_COOKIE_MAX_AGE)}; samesite=lax${secure}`;
  } catch {
    // Хранилище может быть запрещено настройками браузера.
  }
}

/** Непонятное значение читается как режим по умолчанию: настройка не ломает урок. */
export function readGuideMode(value: string | null | undefined): GuideMode {
  return isGuideMode(value) ? value : defaultGuideMode;
}
