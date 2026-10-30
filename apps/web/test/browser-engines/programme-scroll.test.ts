import { chromium, expect } from "@playwright/test";
import { test } from "vitest";

import { scrollProgrammeBoundaryIntoView } from "../support/programme-scroll";

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
