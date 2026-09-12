import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import { requestReaderGuideMode } from "@/shared/api/backend/index.server";
import {
  defaultGuideMode,
  readGuideMode,
  GUEST_GUIDE_MODE_COOKIE,
  type GuideMode,
} from "@/shared/guide-mode";

const guideModeSchema = z.object({ guideMode: z.enum(["example", "own"]) }).strict();

/**
 * Режим, в котором читатель проходит руководства. У вошедшего он хранится за аккаунтом, у гостя —
 * в cookie этого браузера. Значение нужно до отрисовки урока: вариант шага выбирает сервер, иначе
 * читатель увидит чужой вариант и подмену сразу после загрузки.
 *
 * Недоступность этого запроса не ломает урок: режим по умолчанию показывает связный текст.
 */
export async function loadReaderGuideMode(
  accessToken?: string,
): Promise<GuideMode> {
  if (accessToken === undefined) {
    const store = await cookies();
    return readGuideMode(store.get(GUEST_GUIDE_MODE_COOKIE)?.value);
  }
  try {
    const result = await requestReaderGuideMode(accessToken);
    if (!result.ok) return defaultGuideMode;
    const parsed = guideModeSchema.safeParse(result.body);
    return parsed.success ? parsed.data.guideMode : defaultGuideMode;
  } catch {
    return defaultGuideMode;
  }
}
