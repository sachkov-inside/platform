import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import { requestReaderProductMode } from "@/shared/api/backend/index.server";
import {
  defaultProductMode,
  productModeSchema,
  readProductMode,
  GUEST_PRODUCT_MODE_COOKIE,
  PRODUCT_MODE_HINT_COOKIE,
  type ProductMode,
} from "@/shared/product-mode";

const readerProductModeSchema = z
  .object({ productMode: productModeSchema })
  .strict();

/**
 * Режим, в котором читатель проходит руководства. У вошедшего он хранится за аккаунтом, у гостя —
 * в cookie этого браузера. Значение нужно до отрисовки урока: вариант шага выбирает сервер, иначе
 * читатель увидит чужой вариант и подмену сразу после загрузки.
 *
 * Недоступность этого запроса не ломает урок: режим по умолчанию показывает связный текст.
 */
export async function loadReaderProductMode(
  accessToken?: string,
): Promise<ProductMode> {
  if (accessToken === undefined) {
    const store = await cookies();
    return readProductMode(store.get(GUEST_PRODUCT_MODE_COOKIE)?.value);
  }
  try {
    const result = await requestReaderProductMode(accessToken);
    if (!result.ok) return defaultProductMode;
    const parsed = readerProductModeSchema.safeParse(result.body);
    return parsed.success ? parsed.data.productMode : defaultProductMode;
  } catch {
    return defaultProductMode;
  }
}

/**
 * Видел ли этот браузер подсказку о двух режимах. Ответ нужен серверу до отрисовки урока: иначе
 * подсказка появилась бы после гидратации и сдвинула текст под собой.
 */
export async function readerHasSeenProductModeHint(): Promise<boolean> {
  const store = await cookies();
  return store.get(PRODUCT_MODE_HINT_COOKIE)?.value === "seen";
}
