import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";
import {
  expect,
  test,
  type BrowserContext,
  type TestInfo,
} from "@playwright/test";
import { z } from "zod";

const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
const journal = z.object({
  reads: z.array(
    z.object({ path: z.string(), authorized: z.boolean(), status: z.number() }),
  ),
});
async function saveEvidence(
  info: TestInfo,
  name: string,
  body: string | Buffer,
) {
  const directory = evidenceDirectory("issue-1710");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${info.project.name}-${name}`), body);
}
async function signIn(context: BrowserContext, baseURL: string, slug: string) {
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
              // deterministic-test-allow wall-clock: the separate production Web and Logto processes validate this synthetic session with their live clock.
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
}
for (const scenario of [
  "guest",
  "paid",
  "manual",
  "stopped",
  "archive",
  "waitlist",
  "unknown",
] as const) {
  test(`one request-owned Product reader projection: ${scenario}`, async ({
    page,
    context,
    request,
    baseURL,
  }, info) => {
    if (baseURL === undefined) throw new Error("Web origin required");
    const slug = `reader-state-${scenario}${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
    if (["paid", "manual", "archive", "unknown"].includes(scenario)) {
      await signIn(context, baseURL, slug);
    }
    await request.delete(`${backend}/__product-reader-state`);
    const documentResponse = await page.goto(`/products/${slug}`, {
      waitUntil: "commit",
    });
    await documentResponse?.finished();
    const reads = journal.parse(
      await (await request.get(`${backend}/__product-reader-state`)).json(),
    ).reads;
    const journalBody = JSON.stringify({ scenario, reads }, null, 2);
    await saveEvidence(info, `${scenario}-http.json`, journalBody);
    await info.attach("product-reader-state-http-journal.json", {
      body: journalBody,
      contentType: "application/json",
    });

    const visibleLanding = page
      .locator(`[data-product-landing="${slug}"]`)
      .filter({ visible: true });
    await expect(visibleLanding).toHaveCount(1);
    await expect(visibleLanding).toBeVisible();
    const holder = ["paid", "manual", "archive"].includes(scenario);
    if (holder) {
      await expect(
        page
          .locator(".aie-learning-film")
          .getByRole("link", { name: "Продолжить обучение" }),
      ).toBeVisible();
      await expect(
        page
          .locator(".aie-learning-status")
          .getByRole("link", { name: "Продолжить обучение" }),
      ).toBeVisible();
    } else if (scenario === "waitlist") {
      await expect(
        page
          .getByRole("button", { name: "Вступить в список ожидания" })
          .first(),
      ).toBeVisible();
      await expect(
        page
          .getByRole("link", { name: "Открыть программу", exact: true })
          .last(),
      ).toHaveAttribute("href", `/products/${slug}/programme`);
    } else if (scenario === "guest") {
      await expect(
        page.getByRole("link", { name: /^Оплатить/u }).first(),
      ).toHaveAttribute("href", `/products/${slug}/buy`);
    } else {
      await expect(page.getByRole("link", { name: /^Оплатить/u })).toHaveCount(
        0,
      );
      await expect(page.locator(".aie-learning-film")).toHaveCount(0);
    }
    for (const suffix of ["/access", "/intake", "/membership"])
      expect(
        reads.filter((row) => row.path.endsWith(suffix)).length,
      ).toBeLessThanOrEqual(1);
    expect(
      reads.filter((row) =>
        row.path.startsWith("/billing/product-sales-states?"),
      ),
    ).toHaveLength(1);
    const continuations = reads.filter((row) =>
      row.path.startsWith("/reading-activity/product-continuation/"),
    );
    expect(continuations).toHaveLength(holder ? 1 : 0);
    expect(continuations.every((row) => row.authorized)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (["manual", "waitlist", "unknown"].includes(scenario)) {
      const capture = await screenshotWholePage(page);
      await saveEvidence(info, `${scenario}.png`, capture);
      await info.attach(`reader-state-${scenario}.png`, {
        body: capture,
        contentType: "image/png",
      });
    }
  });
}

test("the same public Product shell isolates guest, holder and later guest across requests", async ({
  browser,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  await request.delete(`${backend}/__product-reader-state`);
  for (const holder of [false, true, false]) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? null,
    });
    try {
      if (holder) await signIn(context, baseURL, slug);
      const page = await context.newPage();
      const response = await page.goto(`${baseURL}/products/${slug}`, {
        waitUntil: "commit",
      });
      await response?.finished();
      if (holder)
        await expect(
          page
            .locator(".aie-learning-film")
            .getByRole("link", { name: "Продолжить обучение" }),
        ).toBeVisible();
      else {
        await expect(page.locator(".aie-learning-film")).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: /^Оплатить/u }).first(),
        ).toHaveAttribute("href", `/products/${slug}/buy`);
      }
    } finally {
      await context.close();
    }
  }
  const journalBody = JSON.stringify(
    await (await request.get(`${backend}/__product-reader-state`)).json(),
    null,
    2,
  );
  await saveEvidence(info, "cross-request-http.json", journalBody);
  await info.attach("cross-request-http-journal.json", {
    body: journalBody,
    contentType: "application/json",
  });
});

test("Home displays the same Product learning state while its shared pin stays public", async ({
  browser,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  const owner = await browser.newContext({
    viewport: info.project.use.viewport ?? null,
  });
  await signIn(owner, baseURL, slug);
  const invalidatePin = async () => {
    const response = await owner.request.put(
      `${baseURL}/api/authoring/home-pin`,
      {
        headers: { origin: baseURL },
        data: { expectedVersion: 1, productId: null },
      },
    );
    expect(response.status()).toBe(200);
  };
  try {
    await request.post(`${backend}/__product-reader-state?pin=${slug}`);
    await invalidatePin();
    await request.delete(`${backend}/__product-reader-state`);
    const page = await owner.newPage();
    const response = await page.goto(baseURL, { waitUntil: "commit" });
    await response?.finished();
    await expect(
      page.getByRole("link", { name: "Продолжить обучение", exact: true }),
    ).toHaveAttribute("href", `/products/${slug}/programme`);
    const reads = journal.parse(
      await (await request.get(`${backend}/__product-reader-state`)).json(),
    ).reads;
    expect(
      reads.filter((row) =>
        row.path.startsWith("/reading-activity/product-continuation/"),
      ),
    ).toHaveLength(1);
    expect(
      reads
        .filter((row) => row.path === "/library/home")
        .every((row) => !row.authorized),
    ).toBe(true);
    const journalBody = JSON.stringify(reads, null, 2);
    await saveEvidence(info, "home-http.json", journalBody);
    await info.attach("home-reader-http-journal.json", {
      body: journalBody,
      contentType: "application/json",
    });
    const guest = await browser.newContext({
      viewport: info.project.use.viewport ?? null,
    });
    try {
      const guestPage = await guest.newPage();
      const guestResponse = await guestPage.goto(baseURL, {
        waitUntil: "commit",
      });
      await guestResponse?.finished();
      await expect(
        guestPage.getByRole("link", {
          name: "Продолжить обучение",
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await guest.close();
    }
  } finally {
    await request.post(`${backend}/__product-reader-state`);
    await invalidatePin();
    await owner.close();
  }
});

for (const optional of ["all", "community"] as const) {
  for (const surface of ["Product", "Home", "Programme"] as const) {
    test(`held ${optional} optional responses do not block learning on ${surface}`, async ({
      page,
      context,
      request,
      baseURL,
    }, info) => {
      if (baseURL === undefined) throw new Error("Web origin required");
      const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
      await signIn(context, baseURL, slug);
      await request.post(`${backend}/__product-reader-state?pin=${slug}`);
      await page.request.put(`${baseURL}/api/authoring/home-pin`, {
        headers: { origin: baseURL },
        data: { expectedVersion: 1, productId: null },
      });
      await request.delete(`${backend}/__product-reader-state`);
      await request.post(
        `${backend}/__reader-optional-hold?held=true&target=${optional}`,
      );
      let documentResponse;
      try {
        documentResponse = await page.goto(
          surface === "Home"
            ? "/"
            : `/products/${slug}${surface === "Programme" ? "/programme" : ""}`,
          { waitUntil: "commit" },
        );
        if (surface === "Product") {
          await expect(
            page
              .locator(".aie-learning-film")
              .getByRole("link", { name: "Продолжить обучение" }),
          ).toBeVisible();
          await expect(
            page
              .locator(".aie-learning-status")
              .getByRole("link", { name: "Продолжить обучение" }),
          ).toBeVisible();
        } else if (surface === "Home") {
          await expect(
            page.getByRole("link", { name: "Продолжить обучение" }),
          ).toHaveAttribute("href", `/products/${slug}/programme`);
        } else {
          await expect(
            page.getByRole("link", { name: "Продолжить", exact: true }),
          ).toBeVisible();
        }
        const gate = z
          .object({
            held: z.boolean(),
            aborted: z.number(),
            blocked: z.array(z.string()),
          })
          .parse(
            await (
              await request.get(`${backend}/__reader-optional-hold`)
            ).json(),
          );
        expect(gate.held).toBe(true);
        expect(gate.aborted).toBe(0);
        expect(
          gate.blocked.some((path) =>
            optional === "all"
              ? path.startsWith("/billing/product-prices")
              : path.includes("community-entry"),
          ),
        ).toBe(true);
        const reads = journal.parse(
          await (await request.get(`${backend}/__product-reader-state`)).json(),
        ).reads;
        expect(
          reads.filter((row) => row.path.endsWith("/access")),
        ).toHaveLength(1);
        expect(
          reads.filter((row) =>
            row.path.startsWith("/reading-activity/product-continuation/"),
          ),
        ).toHaveLength(1);
        expect(
          reads.some((row) => row.path.startsWith("/billing/product-prices")),
        ).toBe(true);
        await saveEvidence(
          info,
          `${surface}-${optional}-held-optional-http.json`,
          JSON.stringify({ gate, reads }, null, 2),
        );
      } finally {
        await request.post(`${backend}/__reader-optional-hold?held=false`);
        await documentResponse?.finished();
        await request.post(`${backend}/__product-reader-state?pin=`);
        await page.request.put(`${baseURL}/api/authoring/home-pin`, {
          headers: { origin: baseURL },
          data: { expectedVersion: 1, productId: null },
        });
      }
    });
  }
}
