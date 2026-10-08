import {
  defaultProductMode,
  productModeLabels,
  productModes,
  productModeSchema,
  isProductMode,
} from "@inside/material-blocks";
import type { ProductMode } from "@inside/material-blocks";

export {
  defaultProductMode,
  productModeLabels,
  productModes,
  productModeSchema,
  isProductMode,
  type ProductMode,
};

/**
 * Режим гостя держится в браузере. Это cookie, а не localStorage: страницу урока рисует сервер, и
 * без cookie он не знал бы, какой вариант показать, — читатель увидел бы чужой вариант и подмену
 * сразу после загрузки. Вошедшему читателю cookie не пишется: его режим хранится за ним, и
 * гостевое значение не должно попасть в аккаунт.
 */
export const GUEST_PRODUCT_MODE_COOKIE = "inside.product-mode";

/** Год: и выбор режима, и показанная подсказка — настройки чтения, а не сеанс. */
const PRODUCT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Запоминает выбор гостя в этом браузере. Недоступная cookie меняет только память между входами,
 * а не текущий урок, поэтому отказ здесь молчаливый.
 */
export function rememberGuestProductMode(mode: ProductMode): void {
  writeProductCookie(GUEST_PRODUCT_MODE_COOKIE, mode);
}

function writeProductCookie(name: string, value: string): void {
  try {
    // На площадке cookie не должна уходить по открытому протоколу; на локальном http его нет.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${name}=${value}; path=/; max-age=${String(PRODUCT_COOKIE_MAX_AGE)}; samesite=lax${secure}`;
  } catch {
    // Хранилище может быть запрещено настройками браузера.
  }
}

/** Непонятное значение читается как режим по умолчанию: настройка не ломает урок. */
export function readProductMode(value: string | null | undefined): ProductMode {
  return isProductMode(value) ? value : defaultProductMode;
}

/**
 * Видел ли читатель подсказку о двух режимах. Это тоже cookie, а не localStorage: сервер должен
 * решить судьбу подсказки до отрисовки урока, иначе она появится после гидратации и сдвинет
 * весь текст под собой.
 */
export const PRODUCT_MODE_HINT_COOKIE = "inside.product-mode-hint";

/** Запоминает, что подсказка показана. Недоступная cookie значит лишь, что она придёт ещё раз. */
export function rememberProductModeHintSeen(): void {
  writeProductCookie(PRODUCT_MODE_HINT_COOKIE, "seen");
}
