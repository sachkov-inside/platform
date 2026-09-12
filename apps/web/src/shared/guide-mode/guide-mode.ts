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

/** Год: и выбор режима, и показанная подсказка — настройки чтения, а не сеанс. */
const GUIDE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Запоминает выбор гостя в этом браузере. Недоступная cookie меняет только память между входами,
 * а не текущий урок, поэтому отказ здесь молчаливый.
 */
export function rememberGuestGuideMode(mode: GuideMode): void {
  writeGuideCookie(GUEST_GUIDE_MODE_COOKIE, mode);
}

function writeGuideCookie(name: string, value: string): void {
  try {
    // На площадке cookie не должна уходить по открытому протоколу; на локальном http его нет.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${name}=${value}; path=/; max-age=${String(GUIDE_COOKIE_MAX_AGE)}; samesite=lax${secure}`;
  } catch {
    // Хранилище может быть запрещено настройками браузера.
  }
}

/** Непонятное значение читается как режим по умолчанию: настройка не ломает урок. */
export function readGuideMode(value: string | null | undefined): GuideMode {
  return isGuideMode(value) ? value : defaultGuideMode;
}

/**
 * Видел ли читатель подсказку о двух режимах. Это тоже cookie, а не localStorage: сервер должен
 * решить судьбу подсказки до отрисовки урока, иначе она появится после гидратации и сдвинет
 * весь текст под собой.
 */
export const GUIDE_MODE_HINT_COOKIE = "inside.guide-mode-hint";

/** Запоминает, что подсказка показана. Недоступная cookie значит лишь, что она придёт ещё раз. */
export function rememberGuideModeHintSeen(): void {
  writeGuideCookie(GUIDE_MODE_HINT_COOKIE, "seen");
}
