import { expect, test } from "@playwright/test";

const materialPath = "/materials/initial-fragment-2479";
const storageKey =
  "inside.lesson-parts.v1:50002479-0000-4000-8000-000000000001";

test("a direct lesson heading survives guest progress published during hydration", async ({
  page,
}) => {
  await page.goto(materialPath);
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть часть 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открыть часть 3", exact: true })
    .click();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe("3");

  // Both initial and repeated direct entries are part of the reported guest path.
  for (const entry of ["initial", "repeat"] as const) {
    await test.step(entry, async () => {
      // A document entry from Home must hydrate its own AppShell, not retain a known account.
      await page.goto("/");
      await page.goto(`${materialPath}#итог`, { waitUntil: "commit" });
      const body = page.locator("[data-reader-body]");
      const heading = body.getByRole("heading", {
        name: "Итог",
        exact: true,
        includeHidden: true,
      });
      await expect(body.locator('[data-lesson-part="3"]')).toHaveAttribute(
        "data-hydrated",
        "",
      );
      await expect(heading).toBeVisible();
      await expect(heading).toBeInViewport({ ratio: 1 });
      await expect(
        body.getByRole("button", { name: "Открыть часть 4", exact: true }),
      ).toHaveCount(0);
      await expect(page).toHaveURL(
        new RegExp(`${materialPath}#(?:итог|%D0%B8%D1%82%D0%BE%D0%B3)$`, "u"),
      );
    });
  }
});
