import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const fixture of ["single", "nested"] as const) {
  test(`table names stay readable and stable across real SSR/hydration: ${fixture}`, async ({
    page,
  }) => {
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    // Hold genuine client delivery to inspect server markup before hydration (#2408).
    await page.route("**/_next/static/**/*.js", async (route) => {
      await scriptsReady;
      await route.continue();
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    try {
      await page.goto(`/materials/table-names-${fixture}`, {
        waitUntil: "commit",
      });
      const body = page.locator("[data-reader-body]");
      const names =
        fixture === "single"
          ? ["Таблица в материале"]
          : [
              "Таблица 1 в материале",
              "Таблица 2 в материале",
              "Таблица 3 в материале",
            ];
      const regions = body.getByRole("region");
      const tables = body.getByRole("table");
      await expect(regions).toHaveCount(names.length);
      await expect(tables).toHaveCount(names.length);
      for (const [index, name] of names.entries()) {
        await expect(regions.nth(index)).toHaveAccessibleName(name);
        await expect(regions.nth(index)).toHaveAttribute("tabindex", "0");
        await expect(tables.nth(index)).toHaveAccessibleName(name);
      }
      const handles = await regions.elementHandles();
      const tableHandles = await tables.elementHandles();
      const tableIndex = fixture === "single" ? 0 : 1;
      const active = regions.nth(tableIndex);
      await active.focus();
      await expect(active).toBeFocused();
      const frame = body.locator('[data-reader-block="table"]').nth(tableIndex);
      await expect(frame).toHaveAttribute("data-overflow", "none");
      releaseScripts();
      await expect(frame).toHaveAttribute("data-overflow", "end");
      for (const [index, name] of names.entries()) {
        await expect(regions.nth(index)).toHaveAccessibleName(name);
        await expect(tables.nth(index)).toHaveAccessibleName(name);
        expect(
          await handles[index]?.evaluate(
            (element, at) =>
              element ===
              document.querySelectorAll(
                "[data-reader-body] [data-table-scroll]",
              )[at],
            index,
          ),
        ).toBe(true);
        expect(
          await tableHandles[index]?.evaluate(
            (element, at) =>
              element ===
              document.querySelectorAll("[data-reader-body] table")[at],
            index,
          ),
        ).toBe(true);
      }
      await expect(active).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => active.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      expect(errors).toEqual([]);
      const scan = await new AxeBuilder({ page })
        .include("[data-reader-body]")
        .analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      releaseScripts();
    }
  });
}
