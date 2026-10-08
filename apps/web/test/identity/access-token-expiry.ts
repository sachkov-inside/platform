import type { Page } from "@playwright/test";

import { accessTokenExpiredAt } from "../../../../scripts/identity-proof-access-token.mjs";

/**
 * Ждёт, пока истечёт токен доступа, выданный при входе. Срок идёт по часам стенда Logto, куда
 * виртуальные часы страницы не дотягиваются, поэтому пауза выводится из того, что его определяет:
 * токен выдан не позже `signedInAt` и живёт столько, сколько bootstrap задал ресурсу стенда. Пауза
 * только запускает истечение; что обновление токена действительно понадобилось, проверяет
 * следующий за ней шаг.
 */
export async function waitPastAccessTokenExpiry(
  page: Page,
  signedInAt: number,
): Promise<void> {
  // deterministic-test-allow duration-wait: Logto owns the external token clock; the next step verifies token refresh.
  await page.waitForTimeout(
    Math.max(0, accessTokenExpiredAt(signedInAt) - performance.now()),
  );
}
