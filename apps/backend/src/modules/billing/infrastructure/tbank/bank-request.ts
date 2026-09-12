import { readFileSync } from "node:fs";

import { Agent, fetch as fetchWithDispatcher } from "undici";

import type { BankRequest } from "./tbank.js";

/**
 * Т-Банк предъявляет цепочку до корня УЦ Минцифры, которого нет во встроенном хранилище Node.
 * Корень подключается только к соединениям с банком: остальные исходящие вызовы приложения его
 * не получают, поэтому доверие не расширяется на почту, хранилище и брокер. Проверка сертификата
 * и имени узла остаётся включённой.
 */
export function bankRequest(caFile: string | undefined): BankRequest {
  if (caFile === undefined) return fetch;
  const dispatcher = new Agent({ connect: { ca: readFileSync(caFile, "utf8") } });
  return (url, init) => fetchWithDispatcher(url, { ...init, dispatcher });
}
