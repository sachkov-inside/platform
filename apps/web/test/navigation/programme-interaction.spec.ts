import { expect, test } from "@playwright/test";
import { z } from "zod";

test("the first available programme switch opens the catalogue across delayed hydration", async ({
  page,
}) => {
  let releaseScripts: (() => void) | undefined;
  const scriptsHeld = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  const blockedScripts: string[] = [];
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    blockedScripts.push(route.request().url());
    await scriptsHeld;
    await route.continue();
  });
  try {
    await page.goto("/products/performance-course/programme", {
      waitUntil: "commit",
    });
    const materials = page
      .getByRole("navigation", { name: "Разделы продукта" })
      .getByRole("button", { name: /^Материалы/u });
    await expect(materials).toBeVisible();
    await expect.poll(() => blockedScripts.length).toBeGreaterThan(0);
    // An enabled SSR control promises to accept this first user interaction.
    // A natively disabled control may wait until its handlers are available.
    const availableBeforeHydration = await materials.isEnabled();
    if (availableBeforeHydration) await materials.click();
    releaseScripts?.();
    await expect(materials).toBeEnabled();
    if (!availableBeforeHydration) await materials.click();
    await expect(
      page
        .getByRole("region", { name: "Материалы курса" })
        .getByRole("listitem"),
    ).toHaveCount(12);
  } finally {
    releaseScripts?.();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a selected catalogue survives delivery of optional onboarding without replacing the programme", async ({
  page,
  context,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
  const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  const { wrapSession } = await import("@logto/node");
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      value: await wrapSession(
        {
          accessToken: JSON.stringify({
            [`@${backend}`]: {
              // deterministic-test-allow wall-clock: the production Web process validates this synthetic session with its live clock.
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              scope: "",
              token: `reader-state:${slug}`,
            },
          }),
          idToken: "navigation.id.token",
          refreshToken: "navigation-refresh-token",
        },
        "inside-navigation-logto-cookie-secret-key",
      ),
    },
  ]);
  await request.delete(`${backend}/__product-reader-state`);
  await request.post(
    `${backend}/__reader-optional-hold?held=true&target=community-link`,
  );
  let documentResponse;
  try {
    documentResponse = await page.goto(`/products/${slug}/programme`, {
      waitUntil: "commit",
    });
    const surface = page.locator(`[data-product-programme="${slug}"]:visible`);
    const materials = page
      .getByRole("navigation", { name: "Разделы продукта" })
      .getByRole("button", { name: /^Материалы/u });
    await expect(materials).toBeEnabled();
    await materials.click();
    const catalogue = page.getByRole("region", { name: "Материалы курса" });
    await expect(catalogue.getByRole("listitem")).toHaveCount(12);
    await surface.evaluate((node) => {
      node.setAttribute("data-retained-programme", "true");
    });
    const gate = z
      .object({ blocked: z.array(z.string()) })
      .parse(
        await (await request.get(`${backend}/__reader-optional-hold`)).json(),
      );
    expect(gate.blocked.some((path) => path.includes("community-entry"))).toBe(
      true,
    );
    await request.post(
      `${backend}/__reader-optional-hold?held=false&target=community-link`,
    );
    await documentResponse?.finished();
    await expect(
      page
        .getByRole("navigation", { name: "Разделы продукта" })
        .getByRole("button", { name: "Онбординг", exact: true }),
    ).toBeVisible();
    await expect(surface).toHaveAttribute("data-retained-programme", "true");
    await expect(materials).toHaveAttribute("aria-current", "true");
    await expect(catalogue.getByRole("listitem")).toHaveCount(12);
    const reads = z
      .object({ reads: z.array(z.object({ path: z.string() })) })
      .parse(
        await (await request.get(`${backend}/__product-reader-state`)).json(),
      ).reads;
    await info.attach("programme-optional-http.json", {
      body: JSON.stringify(reads, null, 2),
      contentType: "application/json",
    });
    expect(reads.filter(({ path }) => path.endsWith("/access"))).toHaveLength(
      1,
    );
    expect(
      reads.filter(({ path }) =>
        path.startsWith("/reading-activity/product-continuation/"),
      ),
    ).toHaveLength(1);
    // One server projection plus the existing browser refresh-on-mount policy.
    for (const path of [
      "/accounts/current/billing",
      "/accounts/current/community-entry",
    ])
      expect(
        reads.filter((read) => read.path.split("?")[0] === path),
      ).toHaveLength(2);
  } finally {
    await request.post(`${backend}/__reader-optional-hold?held=false`);
    await documentResponse?.finished();
  }
});
