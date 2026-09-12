import { defaultGuideMode, guideModeLabels, guideModes, isGuideMode } from "@inside/material-blocks";
import type { GuideMode } from "@inside/material-blocks";

export {
  defaultGuideMode,
  guideModeLabels,
  guideModes,
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
export const GUEST_GUIDE_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Непонятное значение читается как режим по умолчанию: настройка не ломает урок. */
export function readGuideMode(value: string | null | undefined): GuideMode {
  return isGuideMode(value) ? value : defaultGuideMode;
}
