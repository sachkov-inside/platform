import { expect, test } from "@playwright/test";

const noticeKey = "inside.storage-notice.v1";

test("acknowledging storage notice works for the document when its acknowledgement cannot be persisted", async ({
  page,
}) => {
  // Synthetic native storage fault for this one key; own application modules and other writes stay real.
  await page.addInitScript((key) => {
    const local = window.localStorage;
    const session = window.sessionStorage;
    const writeLocal = local.setItem.bind(local);
    const writeSession = session.setItem.bind(session);
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
  }, noticeKey);
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
  ).toBeNull();
  await page.reload();
  await expect(notice).toBeVisible();
});
