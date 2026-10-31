import { chromium, expect } from "@playwright/test";
import { test } from "vitest";

import { scrollProgrammeBoundaryIntoView } from "../support/programme-scroll";
import {
  expectLinearProgrammeReturn,
  expectProgrammeReturnTarget,
} from "../support/linear-programme";

test("programme scrolling observes the live composition when its row is replaced during stability checking", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    await page.setContent(`
      <style>
        main { height: 480px; overflow: auto; }
        header { height: 180px; }
        li { height: 56px; }
      </style>
      <main data-application-content>
        <section data-product-programme="composition">
          <header><h1>13 материалов · всё открыто</h1></header>
          <nav aria-label="Разделы продукта"><button aria-current="true">Программа</button><button>Материалы</button></nav>
          <ol>${Array.from({ length: 13 }, (_, index) => `<li data-product-ordinal="${String(index + 1)}">Урок ${String(index + 1)}</li>`).join("")}</ol>
        </section>
      </main>
    `);
    await page.evaluate(() => {
      const programme = document.querySelector("[data-product-programme]");
      const row = document.querySelector<HTMLElement>(
        '[data-product-ordinal="12"]',
      );
      if (programme === null || row === null)
        throw new Error("Programme fixture missing");
      const replace = () => {
        if (!programme.isConnected) return;
        const shell = document.querySelector("main");
        if (shell === null) throw new Error("Fixture shell missing");
        const position = shell.scrollTop;
        programme.replaceWith(programme.cloneNode(true));
        document.documentElement.setAttribute("data-replaced", "true");
        document.documentElement.setAttribute(
          "data-replacement-scroll-delta",
          String(shell.scrollTop - position),
        );
      };
      // The native action completes its scroll before the same logical tree is replaced.
      const scroll = row.scrollIntoView.bind(row);
      row.scrollIntoView = (options) => {
        scroll(options);
        queueMicrotask(replace);
      };
    });

    const cdp = await page.context().newCDPSession(page);
    const worlds: { id: number; name: string }[] = [];
    cdp.on("Runtime.executionContextCreated", ({ context }) =>
      worlds.push(context),
    );
    await cdp.send("Runtime.enable");
    await page.locator('[data-product-ordinal="12"]').count();
    const utility = worlds.find(({ name }) => name.includes("playwright"));
    if (utility === undefined)
      throw new Error("Playwright utility world missing");
    // A geometry-read probe in the browser's automation realm releases replacement
    // after the first real stability measurement, before its next animation frame.
    // It returns the native rectangle unchanged. No duration or retry is involved.
    const probe = await cdp.send("Runtime.evaluate", {
      contextId: utility.id,
      expression: `(() => {
        const row = document.querySelector('[data-product-ordinal="12"]');
        const programme = document.querySelector('[data-product-programme]');
        const measure = row.getBoundingClientRect.bind(row);
        row.getBoundingClientRect = () => {
          const rect = measure();
          queueMicrotask(() => {
            if (!programme.isConnected) return;
            const shell = document.querySelector('main');
            const position = shell.scrollTop;
            programme.replaceWith(programme.cloneNode(true));
            document.documentElement.setAttribute('data-replaced', 'true');
            document.documentElement.setAttribute('data-replacement-scroll-delta', String(shell.scrollTop - position));
          });
          return rect;
        };
      })()`,
    });
    if (probe.exceptionDetails !== undefined)
      throw new Error("Geometry probe failed");

    await scrollProgrammeBoundaryIntoView(page, 12);

    await expect(page.locator("html")).toHaveAttribute("data-replaced", "true");
    await expect(page.locator("html")).toHaveAttribute(
      "data-replacement-scroll-delta",
      "0",
    );
    await expect(page.locator("[data-product-ordinal]")).toHaveCount(13);
    await expect(
      page.getByRole("button", { name: "Программа", exact: true }),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-product-ordinal="12"]')).toBeInViewport();
    await expect(page.locator('[data-product-ordinal="13"]')).toBeInViewport();
  } finally {
    await browser.close();
  }
});

test("linear programme return prepares a replaced link without activating it", async () => {
  const browser = await chromium.launch();
  try {
    const programmeHref =
      "/products/composition/programme?page=1&at=synthetic-material&atPlacement=00000000-0000-4000-8000-000000000001";
    expectProgrammeReturnTarget(programmeHref, programmeHref);
    expect(() =>
      expectProgrammeReturnTarget(
        programmeHref.replace(
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ),
        programmeHref,
      ),
    ).toThrow();
    const href = `#${encodeURIComponent(programmeHref)}`;
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1024 },
      });
      try {
        let requests = 0;
        await context.route("**/*", async (route) => {
          requests += 1;
          await route.abort();
        });
        const page = await context.newPage();
        await page.setContent(`
          <style>
            main { height: 480px; overflow: auto; }
            .spacer { height: 800px; }
            nav { padding: 16px; }
          </style>
          <main>
            <div class="spacer"></div>
            <nav aria-label="Действия материала" data-return-top data-return-generation="initial">
              <a href="${href}">Назад</a>
            </nav>
            <div class="spacer"></div>
            <nav aria-label="Действия в конце материала"><a href="${href}">Назад</a></nav>
            <nav aria-label="Уроки продукта" ${mobile ? "" : "hidden"}>
              <a href="${href}">Программа, урок 1</a>
            </nav>
          </main>
        `);
        await page.evaluate(() => {
          document.documentElement.dataset["replacementCount"] = "0";
          document.documentElement.dataset["activationCount"] = "0";
          document.addEventListener("click", (event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("[data-return-top] a") !== null
            ) {
              const html = document.documentElement;
              html.dataset["activationCount"] = String(
                Number(html.dataset["activationCount"]) + 1,
              );
            }
          });
        });
        if (!mobile) {
          const cdp = await context.newCDPSession(page);
          const worlds: { id: number; name: string }[] = [];
          cdp.on("Runtime.executionContextCreated", ({ context }) =>
            worlds.push(context),
          );
          await cdp.send("Runtime.enable");
          await page.locator("[data-return-top] a").count();
          const utility = worlds.find(({ name }) =>
            name.includes("playwright"),
          );
          if (utility === undefined)
            throw new Error("Playwright utility world missing");
          const probe = await cdp.send("Runtime.evaluate", {
            contextId: utility.id,
            expression: `(() => {
              const navigation = document.querySelector('[data-return-top]');
              const link = navigation.querySelector('a');
              const measure = link.getBoundingClientRect.bind(link);
              link.getBoundingClientRect = () => {
                const rect = measure();
                queueMicrotask(() => {
                  if (!navigation.isConnected) return;
                  const replacement = navigation.cloneNode(true);
                  replacement.setAttribute('data-return-generation', 'replacement');
                  navigation.replaceWith(replacement);
                  const html = document.documentElement;
                  html.dataset.replacementCount = String(Number(html.dataset.replacementCount) + 1);
                });
                return rect;
              };
            })()`,
          });
          if (probe.exceptionDetails !== undefined)
            throw new Error("Geometry probe failed");
        }
        const initialUrl = page.url();
        const action = await expectLinearProgrammeReturn(
          page,
          mobile,
          href,
        ).catch(async (error: unknown) => {
          const observed = await page
            .evaluate(() => ({
              replacements:
                document.documentElement.dataset["replacementCount"],
              activations: document.documentElement.dataset["activationCount"],
            }))
            .catch(() => ({ replacements: "unknown", activations: "unknown" }));
          console.info("linear-return-fixture", { mobile, ...observed });
          throw error;
        });
        await expect(page.locator("html")).toHaveAttribute(
          "data-replacement-count",
          mobile ? "0" : "1",
        );
        expect(
          await action.evaluate((link) => ({
            connected: link.isConnected,
            generation: link
              .closest("nav")
              ?.getAttribute("data-return-generation"),
          })),
        ).toEqual({
          connected: true,
          generation: mobile ? "initial" : "replacement",
        });
        await expect(action).toBeVisible();
        await expect(action).toHaveAttribute("href", href);
        await expect(page.locator("html")).toHaveAttribute(
          "data-activation-count",
          "0",
        );
        expect(page.url()).toBe(initialUrl);
        expect(requests).toBe(0);
        await action.click();
        await expect(page.locator("html")).toHaveAttribute(
          "data-activation-count",
          "1",
        );
        await expect(page).toHaveURL(`${initialUrl}${href}`);
        expect(decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(
          programmeHref,
        );
        expect(requests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
