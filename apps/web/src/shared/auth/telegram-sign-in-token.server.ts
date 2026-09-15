import "server-only";

import { decodeJwt } from "jose";

/**
 * Токен выдан входом через Telegram: Logto кладёт в него `inside_telegram_sign_in`. Проверка
 * подписи — дело backend; здесь только выбор пути завершения входа.
 */
export function isTelegramSignInToken(accessToken: string): boolean {
  try {
    return decodeJwt(accessToken).inside_telegram_sign_in !== undefined;
  } catch {
    return false;
  }
}
