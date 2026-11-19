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
      return {
        initialCount,
        commits,
        disconnect: () => {
          observer.disconnect();
        },
      };
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
      await historyReset.evaluate((record) => {
        record.disconnect();
      });
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

test("early native programme scroll survives initial hydration", async ({
  page,
  request,
}, info) => {
  const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
  const allocated = await request.post(
    `${backend}/__reader-title-fixtures?layout=programme-reveal`,
  );
  const fixture = fixtureSchema.parse(await allocated.json());
  let releaseScripts: (() => void) | undefined;
  const scriptsHeld = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  let blockedScripts = 0;
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    blockedScripts += 1;
    await scriptsHeld;
    await route.continue();
  });
  try {
    expect(allocated.status()).toBe(201);
    const first = fixture.materialSlugs[0];
    if (first === undefined) throw new Error("Missing controlled first lesson");
    await page.goto(
      `/products/${fixture.productSlug}/programme?page=1&at=${first}`,
      { waitUntil: "commit" },
    );
    const surface = page.locator(
      `[data-product-programme="${fixture.productSlug}"]:visible`,
    );
    const rows = surface.locator("[data-product-ordinal]");
    const materials = page
      .getByRole("navigation", { name: "Разделы продукта" })
      .getByRole("button", { name: /^Материалы/u });
    await expect(rows).toHaveCount(12);
    await expect.poll(() => blockedScripts).toBeGreaterThan(0);
    await expect(materials).toBeDisabled();
    // The SSR list already accepts native wheel input while application scripts are held.
    const point = await rows.nth(3).boundingBox();
    if (point === null) throw new Error("Missing visible programme geometry");
    await page.mouse.move(
      point.x + point.width / 2,
      Math.min(point.y + point.height / 2, 400),
    );
    await page.mouse.wheel(
      0,
      await rows
        .nth(11)
        .evaluate((node) =>
          Math.max(1, node.getBoundingClientRect().bottom - innerHeight + 1),
        ),
    );
    const position = () =>
      surface.evaluate((node) => {
        let root = node.parentElement;
        while (
          root !== null &&
          !/^(auto|scroll)$/.test(getComputedStyle(root).overflowY)
        )
          root = root.parentElement;
        return {
          kind: root === null ? "document" : root.tagName,
          top: root?.scrollTop ?? window.scrollY,
        };
      });
    await expect.poll(async () => (await position()).top).toBeGreaterThan(0);
    const before = await position();
    expect(before.kind).toBe(
      info.project.name === "desktop-chromium" ? "MAIN" : "document",
    );
    releaseScripts?.();
    await expect(materials).toBeEnabled();
    await expect(rows).toHaveCount(24);
    await expect.poll(async () => (await position()).top).toBeGreaterThan(0);
    await info.attach("early-programme-scroll.json", {
      contentType: "application/json",
      body: JSON.stringify({
        before,
        after: await position(),
        count: await rows.count(),
        nativeWheel: true,
      }),
    });
  } finally {
    releaseScripts?.();
    await page.unrouteAll({ behavior: "wait" });
    const deleted = await request.delete(
      `${backend}/__reader-title-fixtures/${fixture.scope}`,
    );
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
  }
});

test("a direct programme lesson address starts at its lesson from zero", async ({
  page,
  request,
}) => {
  const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
  const allocated = await request.post(
    `${backend}/__reader-title-fixtures?layout=programme-reveal`,
  );
  const fixture = fixtureSchema.parse(await allocated.json());
  try {
    expect(allocated.status()).toBe(201);
    const later = fixture.materialSlugs[24];
    if (later === undefined) throw new Error("Missing controlled lesson");
    await page.goto(
      `/products/${fixture.productSlug}/programme?page=3&at=${later}`,
    );
    const surface = page.locator(
      `[data-product-programme="${fixture.productSlug}"]:visible`,
    );
    const rows = surface.locator("[data-product-ordinal]");
    await expect(
      page
        .getByRole("navigation", { name: "Разделы продукта" })
        .getByRole("button", { name: /^Материалы/u }),
    ).toBeEnabled();
    await expect(rows).toHaveCount(36);
    await expect(rows.nth(24)).toBeInViewport();
  } finally {
    const deleted = await request.delete(
      `${backend}/__reader-title-fixtures/${fixture.scope}`,
    );
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
  }
});

for (const positionSource of [
  "native document reload",
  "test-restored MAIN",
] as const) {
  test(`a programme position from ${positionSource} survives initial hydration`, async ({
    page,
    request,
  }, info) => {
    test.skip(
      (positionSource === "test-restored MAIN") !==
        (info.project.name === "desktop-chromium"),
      "Native document reload and explicitly restored desktop MAIN are separate position sources",
    );
    const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
    const allocated = await request.post(
      `${backend}/__reader-title-fixtures?layout=programme-reveal`,
    );
    const fixture = fixtureSchema.parse(await allocated.json());
    let releaseScripts: (() => void) | undefined;
    try {
      expect(allocated.status()).toBe(201);
      const later = fixture.materialSlugs[24];
      if (later === undefined) throw new Error("Missing controlled lesson");
      await page.goto(
        `/products/${fixture.productSlug}/programme?page=3&at=${later}`,
      );
      const surface = page.locator(
        `[data-product-programme="${fixture.productSlug}"]:visible`,
      );
      const rows = surface.locator("[data-product-ordinal]");
      const materials = page
        .getByRole("navigation", { name: "Разделы продукта" })
        .getByRole("button", { name: /^Материалы/u });
      await expect(materials).toBeEnabled();
      await expect(rows).toHaveCount(36);
      await expect(rows.nth(24)).toBeInViewport();
      const position = () =>
        surface.evaluate((node) => {
          let root = node.parentElement;
          while (
            root !== null &&
            !/^(auto|scroll)$/.test(getComputedStyle(root).overflowY)
          )
            root = root.parentElement;
          return root?.scrollTop ?? window.scrollY;
        });
      await surface.evaluate((node) => {
        let root = node.parentElement;
        while (
          root !== null &&
          !/^(auto|scroll)$/.test(getComputedStyle(root).overflowY)
        )
          root = root.parentElement;
        if (root === null) window.scrollTo({ top: 300, behavior: "instant" });
        else root.scrollTo({ top: 300, behavior: "instant" });
      });
      await expect.poll(position).toBe(300);
      const scriptsHeld = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });
      let blockedScripts = 0;
      await page.route("**/_next/static/chunks/*.js", async (route) => {
        blockedScripts += 1;
        await scriptsHeld;
        await route.continue();
      });
      // A real reload restores this document's native scroll position. No test scroll follows it.
      await page.reload({ waitUntil: "commit" });
      await expect(rows).toHaveCount(36);
      await expect.poll(() => blockedScripts).toBeGreaterThan(0);
      await expect(materials).toBeDisabled();
      if (positionSource === "test-restored MAIN") {
        // Reload restores the document on mobile, but not a nested desktop scroll element.
        // This setup establishes MAIN's position explicitly; it makes no native restoration claim.
        await page.locator("[data-application-content]").evaluate((root) => {
          root.scrollTo({ top: 300, behavior: "instant" });
        });
      }
      await expect.poll(position).toBe(300);
      releaseScripts?.();
      await expect(materials).toBeEnabled();
      await expect.poll(position).toBe(300);
      await expect(rows.nth(24)).not.toBeInViewport();
      await info.attach("restored-programme-scroll.json", {
        contentType: "application/json",
        body: JSON.stringify({
          nativeReload: true,
          positionSource,
          expected: 300,
          actual: await position(),
          root: info.project.name === "desktop-chromium" ? "MAIN" : "document",
        }),
      });
    } finally {
      releaseScripts?.();
      await page.unrouteAll({ behavior: "wait" });
      const deleted = await request.delete(
        `${backend}/__reader-title-fixtures/${fixture.scope}`,
      );
      expect(deleted.status()).toBe(200);
      expect(await deleted.json()).toEqual({ deleted: true });
    }
  });
}
