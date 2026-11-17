import { expect, test } from "@playwright/test";

const noticeKey = "inside.storage-notice.v1";

test("storage notice follows a genuine clear after its ordinary key event", async ({
  page,
  context,
}) => {
  await page.goto("/legal/privacy");
  const notice = page.getByRole("region", { name: "Хранение в браузере" });
  const acknowledge = notice.getByRole("button", { name: "Понятно" });
  await expect(notice).toBeVisible();
  await acknowledge.click();
  await expect(notice).toBeHidden();
  const other = await context.newPage();
  try {
    await other.goto("/legal/terms");
    await other.evaluate((key) => {
      localStorage.setItem(key, "previous-edition");
    }, noticeKey);
    await expect(notice).toBeVisible();
    await acknowledge.click();
    await expect(notice).toBeHidden();
    // Observe delivery; the storage methods and every application module remain genuine.
    await page.evaluate(() => {
      const observed = (event: StorageEvent) => {
        if (event.key !== null) return;
        document.documentElement.setAttribute(
          "data-notice-native-clear",
          String(event.isTrusted),
        );
        window.removeEventListener("storage", observed);
      };
      window.addEventListener("storage", observed);
    });
    await other.evaluate(() => {
      localStorage.clear();
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-notice-native-clear",
      "true",
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), noticeKey),
    ).toBeNull();
    await expect(notice).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number.parseFloat(
            document.documentElement.style.getPropertyValue(
              "--storage-notice-space",
            ),
          ),
        ),
      )
      .toBeGreaterThan(0);
  } finally {
    await other.close();
  }
});
