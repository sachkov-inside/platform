import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { scrollProgrammeBoundaryIntoView } from "../support/programme-scroll";

const fixtureSchema = z.object({
  scope: z.uuid(),
  productSlug: z.string(),
  materialSlugs: z.array(z.string()).length(120),
});

async function readFirstProgrammeBoundary(page: Page, productSlug: string) {
  return page.locator("[data-application-content]").evaluate((shell, slug) => {
    const currentProgramme = Array.from(
      shell.querySelectorAll<HTMLElement>("[data-product-programme]"),
    ).find(
      (programme) =>
        programme.getAttribute("data-product-programme") === slug &&
        programme.getClientRects().length > 0,
    );
    const node = currentProgramme?.querySelector<HTMLElement>(
      '[data-product-ordinal="12"]',
    );
    if (node === undefined || node === null)
      throw new Error("Missing current Programme boundary");
    const rect = (element: Element) => {
      const { x, y, width, height, top, right, bottom, left } =
        element.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    };
    let elementRoot = node.parentElement;
    while (
      elementRoot !== null &&
      !/^(auto|scroll)$/.test(getComputedStyle(elementRoot).overflowY)
    )
      elementRoot = elementRoot.parentElement;
    const root = elementRoot ?? document.scrollingElement;
    if (root === null) throw new Error("Missing Programme scroll root");
    return {
      time: performance.now(),
      connected: node.isConnected,
      belongsToCurrentProgramme: currentProgramme?.contains(node) ?? false,
      isCurrentBoundary:
        currentProgramme?.querySelectorAll("[data-product-ordinal]")[11] ===
        node,
      targetRect: rect(node),
      root: {
        kind: elementRoot === null ? "document" : "element",
        tag: root.tagName,
        connected: root.isConnected,
        scrollTop: root.scrollTop,
        clientHeight: root.clientHeight,
        scrollHeight: root.scrollHeight,
        rect: rect(root),
      },
      visibleRoot: {
        top: elementRoot === null ? 0 : rect(elementRoot).top,
        bottom: elementRoot === null ? innerHeight : rect(elementRoot).bottom,
      },
      temporaryBlockPresent:
        document.querySelector('[hidden][id^="S:"]') !== null,
    };
  }, productSlug);
}

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
    const before = await readFirstProgrammeBoundary(page, fixture.productSlug);
    await scrollProgrammeBoundaryIntoView(page, 12);
    const firstReveal = {
      action: "current row native scrollIntoView center",
      before,
      after: await readFirstProgrammeBoundary(page, fixture.productSlug),
    };
    try {
      await expect(rows).toHaveCount(24);
    } finally {
      await info.attach("programme-first-reveal.json", {
        contentType: "application/json",
        body: JSON.stringify(firstReveal),
      });
    }
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

test("the current programme boundary reveals after Materials replaces its rows", async ({
  page,
  request,
}, info) => {
  const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
  const allocated = await request.post(
    `${backend}/__reader-title-fixtures?layout=programme-reveal`,
  );
  const fixture = fixtureSchema.parse(await allocated.json());
  try {
    expect(allocated.status()).toBe(201);
    const first = fixture.materialSlugs[0];
    if (first === undefined) throw new Error("Missing controlled first lesson");
    await page.goto(
      `/products/${fixture.productSlug}/programme?page=1&at=${first}`,
    );
    const surface = page.locator(
      `[data-product-programme="${fixture.productSlug}"]:visible`,
    );
    const rows = surface.locator("[data-product-ordinal]");
    await expect(rows).toHaveCount(12);
    const tabs = page.getByRole("navigation", { name: "Разделы продукта" });
    const materials = tabs.getByRole("button", { name: /^Материалы/u });
    const programme = tabs.getByRole("button", { name: /^Программа/u });
    await expect(materials).toBeEnabled();
    const original = await rows.nth(11).elementHandle();
    try {
      expect(await original.evaluate((node) => node.isConnected)).toBe(true);
      await materials.click();
      await expect(materials).toHaveAttribute("aria-current", "true");
      expect(await original.evaluate((node) => node.isConnected)).toBe(false);
      await programme.click();
      await expect(programme).toHaveAttribute("aria-current", "true");
      await expect(rows).toHaveCount(12);
      expect(
        await rows.nth(11).evaluate((node, old) => node === old, original),
      ).toBe(false);
      const before = await readFirstProgrammeBoundary(
        page,
        fixture.productSlug,
      );
      expect(before.connected).toBe(true);
      expect(before.belongsToCurrentProgramme).toBe(true);
      expect(before.isCurrentBoundary).toBe(true);
      expect(before.root.tag).toBe(
        info.project.name === "desktop-chromium" ? "MAIN" : "HTML",
      );
      expect(before.targetRect.top).toBeGreaterThan(before.visibleRoot.bottom);
      await scrollProgrammeBoundaryIntoView(page, 12);
      const after = await readFirstProgrammeBoundary(page, fixture.productSlug);
      try {
        await expect(rows).toHaveCount(24);
        expect(after.connected).toBe(true);
        expect(after.belongsToCurrentProgramme).toBe(true);
        expect(after.isCurrentBoundary).toBe(true);
        expect(after.root.tag).toBe(before.root.tag);
        expect(after.root.scrollTop).toBeGreaterThan(before.root.scrollTop);
        expect(after.targetRect.top).toBeGreaterThanOrEqual(
          after.visibleRoot.top,
        );
        expect(after.targetRect.bottom).toBeLessThanOrEqual(
          after.visibleRoot.bottom,
        );
      } finally {
        await info.attach("programme-replaced-boundary.json", {
          contentType: "application/json",
          body: JSON.stringify({
            oldRowDisconnected: true,
            newRowIdentity: true,
            action: "current row native scrollIntoView center",
            before,
            after,
          }),
        });
      }
    } finally {
      await original.dispose();
    }
  } finally {
    const deleted = await request.delete(
      `${backend}/__reader-title-fixtures/${fixture.scope}`,
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
      // Mobile reload restores the native document position; desktop setup below restores MAIN.
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
