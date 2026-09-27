import type { Page } from "@playwright/test";

/**
 * Ждёт, пока истечёт токен доступа, выданный при входе. Срок идёт по часам стенда Logto, куда
 * виртуальные часы страницы не дотягиваются, поэтому пауза выводится из того, что его определяет:
 * токен выдан не позже `signedInAt` и живёт `IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS`, с которым
 * bootstrap создал ресурс стенда. Пауза только запускает истечение; что обновление токена
 * действительно понадобилось, проверяет следующий за ней шаг.
 */
export async function waitPastAccessTokenExpiry(
  page: Page,
  signedInAt: number,
): Promise<void> {
  const lifetimeSeconds = Number(
    process.env["IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS"],
  );
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds <= 0)
    throw new Error(
      "IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS is required: it is the lifetime the stand was bootstrapped with",
    );
  // `exp` в токене — целые секунды; лишняя секунда покрывает округление.
  const expiredAt = signedInAt + (lifetimeSeconds + 1) * 1_000;
  await page.waitForTimeout(Math.max(0, expiredAt - Date.now()));
}
