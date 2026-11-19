import { expect, test } from "@playwright/test";

import { observeAppShellPrefetch } from "../support/app-shell-prefetch";

test("measures the committed route and query and consumes its start mark", async ({
  page,
}) => {
  const product = "/products/navigation-proof",
    programme = product + "/programme";
  const prefetch = await observeAppShellPrefetch(page, programme);
  await page.goto(product);
  await prefetch.ready();
  const enter = page.locator(`a[href='${programme}']`).first();
  await expect(enter).toBeVisible();
  const records = () =>
    page.evaluate(() =>
      performance
        .getEntriesByName("inside:navigation", "measure")
        .filter((entry) => entry instanceof PerformanceMeasure)
        .map((entry) => ({
          detail: entry.detail as unknown,
          startTime: entry.startTime,
        })),
    );
  expect(await records()).toEqual([]);
  await enter.click();
  await expect(page).toHaveURL(programme);
  await expect
    .poll(records)
    .toEqual([expect.objectContaining({ detail: { url: programme } })]);
  const start = await page.evaluate(() => {
    performance.mark("inside:navigation-start", { startTime: 0 });
    const latest = performance.mark("inside:navigation-start");
    history.replaceState(null, "", location.pathname + "?from=history");
    return latest.startTime;
  });
  await expect.poll(records).toEqual([
    expect.objectContaining({ detail: { url: programme } }),
    expect.objectContaining({
      startTime: start,
      detail: { url: programme + "?from=history" },
    }),
  ]);
  expect(
    await page.evaluate(
      () =>
        performance.getEntriesByName("inside:navigation-start", "mark").length,
    ),
  ).toBe(0);
});
