import { expect, test } from "@playwright/test";
import { z } from "zod";

const fixtureSchema = z.object({
  scope: z.uuid(),
  productSlug: z.string(),
  materialSlugs: z.array(z.string()).length(120),
});

test("an active programme accepts semantic native query changes and History return", async ({
  page,
  request,
}, info) => {
  const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
  const allocated = await request.post(
    `${backend}/__reader-title-fixtures?layout=programme-reveal`,
  );
  const raw: unknown = await allocated.json();
  const { scope } = z.object({ scope: z.uuid() }).parse(raw);
  try {
    expect(allocated.status()).toBe(201);
    const fixture = fixtureSchema.parse(raw);
    const first = fixture.materialSlugs[0];
    const later = fixture.materialSlugs[24];
    if (first === undefined || later === undefined)
      throw new Error("Missing controlled lesson");
    const path = `/products/${fixture.productSlug}/programme`;
    const initial = `${path}?page=1&at=${first}`;
    await page.goto(initial);
    const surface = page.locator(
      `[data-product-programme="${fixture.productSlug}"]:visible`,
    );
    const rows = surface.locator("[data-product-ordinal]");
    await expect(rows).toHaveCount(12);
    await rows.nth(11).evaluate((node) => {
      node.scrollIntoView({ block: "end", behavior: "instant" });
    });
    await expect(rows).toHaveCount(24);
    const deep = `${path}?page=3&at=${later}`;
    await page.evaluate((url) => {
      window.history.pushState(null, "", url);
    }, deep);
    await expect(rows).toHaveCount(36);
    await expect(rows.nth(24)).toBeInViewport();
    const historyReset = await surface.evaluateHandle((programme) => {
      const initialCount = programme.querySelectorAll(
        "[data-product-ordinal]",
      ).length;
      const commits: { readonly href: string; readonly count: number }[] = [];
      const observer = new MutationObserver(() => {
        commits.push({
          href: window.location.pathname + window.location.search,
          count: programme.querySelectorAll("[data-product-ordinal]").length,
        });
      });
      observer.observe(programme, { childList: true, subtree: true });
      return { initialCount, commits, disconnect: () => observer.disconnect() };
    });
    try {
      expect(await historyReset.evaluate((record) => record.initialCount)).toBe(
        36,
      );
      await page.goBack();
      await expect(page).toHaveURL(initial);
      // Back commits the query's initial batch. Native scroll restoration may then reveal more.
      await expect
        .poll(() =>
          historyReset.evaluate(
            (record, href) =>
              record.commits
                .filter((commit) => commit.href === href)
                .map((commit) => commit.count),
            initial,
          ),
        )
        .toContain(12);
      await info.attach("native-history-query-reset.json", {
        contentType: "application/json",
        body: JSON.stringify(
          await historyReset.evaluate((record) => record.commits),
        ),
      });
    } finally {
      await historyReset.evaluate((record) => record.disconnect());
      await historyReset.dispose();
    }
    await page.goForward();
    await expect(page).toHaveURL(deep);
    await expect(rows).toHaveCount(36);
    const catalogue = `${path}?part=materials`;
    await page.evaluate((url) => {
      window.history.pushState(null, "", url);
    }, catalogue);
    await expect(
      page.getByRole("region", { name: "Материалы курса" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Разделы продукта" })
        .getByRole("button", { name: /^Материалы/u }),
    ).toHaveAttribute("aria-current", "true");
    await page.goBack();
    await expect(page).toHaveURL(deep);
    await expect(rows).toHaveCount(36);
    await info.attach("active-programme-query-proof.json", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          scope,
          path,
          initial,
          deep,
          catalogue,
          sequence: [12, 24, 36, 12, 36, "catalogue", 36],
          nativeHistory: true,
        },
        null,
        2,
      ),
    });
  } finally {
    const deleted = await request.delete(
      `${backend}/__reader-title-fixtures/${scope}`,
    );
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
  }
});
