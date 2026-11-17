import { expect, test } from "@playwright/test";

const noticeKey = "inside.storage-notice.v1";

for (const initialValue of [null, "prior-edition"] as const) {
  test(`acknowledging storage notice works without persistence (${initialValue === null ? "empty storage" : "non-current stored value"})`, async ({
    page,
  }) => {
    // Synthetic native storage fault for this one key; own application modules and other writes stay real.
    await page.addInitScript(
      ({ key, initialValue }) => {
        const local = window.localStorage;
        const session = window.sessionStorage;
        const writeLocal = local.setItem.bind(local);
        const writeSession = session.setItem.bind(session);
        if (initialValue !== null) writeLocal(key, initialValue);
        Storage.prototype.setItem = function (
          this: Storage,
          writtenKey: string,
          value: string,
        ) {
          if (this === local) {
            if (writtenKey === key)
              throw new DOMException(
                "Synthetic full storage",
                "QuotaExceededError",
              );
            writeLocal(writtenKey, value);
          } else if (this === session) {
            writeSession(writtenKey, value);
          } else {
            throw new TypeError("Unexpected native storage receiver");
          }
        };
      },
      { key: noticeKey, initialValue },
    );
    await page.goto("/legal/privacy");
    await expect(
      page.getByRole("button", { name: "Войти через Telegram" }).first(),
    ).toBeVisible();
    const notice = page.getByRole("region", { name: "Хранение в браузере" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Понятно" }).click();
    await expect(notice).toBeHidden();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), noticeKey),
    ).toBe(initialValue);
    await page.reload();
    await expect(notice).toBeVisible();
  });
}
