import { expect, type BrowserContext } from "@playwright/test";

import type { PassOutcome } from "./pass-cells";
import { checkPassRequest, PassRequestRejected } from "./pass-requests";

/** Тело или отказ Reader после успешного ответа приложения; сбой перехода остаётся ошибкой. */
export async function observeBodyPage(
  context: BrowserContext,
  slug: string,
  snippet: string,
): Promise<{ readonly observed: PassOutcome; readonly note?: string }> {
  const page = await context.newPage();
  try {
    const response = await page.goto(`/materials/${slug}`);
    if (response === null || !response.ok())
      throw new Error(
        `Material page did not return a successful response: HTTP ${String(response?.status())}`,
      );
    const finalUrl = response.url();
    const decision = checkPassRequest({ method: "GET", url: finalUrl });
    if (!decision.allowed)
      throw new PassRequestRejected("GET", finalUrl, decision.reason);
    const state = page
      .locator(
        "[data-application-content] [data-material-reader-state='available'], [data-application-content] [data-material-reader-state='access-required']",
      )
      .first();
    await expect(state).toBeVisible();
    // Закрытые bytes ищутся во всём документе, включая данные RSC.
    if ((await page.content()).includes(snippet))
      return { observed: "allowed" };
    if (
      (await state.getAttribute("data-material-reader-state")) ===
      "access-required"
    )
      return {
        observed: "denied",
        note: `HTTP ${String(response.status())}; access-required`,
      };
    throw new Error("Material page shows neither the body nor a denial");
  } finally {
    await page.close();
  }
}
