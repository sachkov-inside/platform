import { expect as ui } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("authoring-shell");
afterAll(() => fixture.close(), 30_000);

test.each([false, true])(
  "Chromium delivers only the mobile change after reaching desktop (new explicit opening: %s)",
  async (reopen) => {
    const { browsers, url } = await fixture.start();
    const browser = browsers.get("chromium");
    if (!browser) throw new Error("Missing Chromium");
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    try {
      await page.goto(url);
      const viewport = page.locator('iframe[title="Админка"]');
      const frame = viewport.contentFrame();
      const trigger = frame.getByRole("button", { name: "Ещё" });
      const sheet = frame.getByRole("dialog", { name: "Ещё" });
      await viewport.evaluate((node) => {
        node.style.width = "1440px";
      });
      await ui(
        frame.getByRole("navigation", { name: "Разделы админки" }),
      ).toBeVisible();
      await viewport.evaluate((node) => {
        node.style.width = "390px";
      });
      await ui(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.click();
      await ui(sheet).toBeVisible();
      await viewport.evaluate((node) => {
        node.style.width = "400px";
      });
      await ui(sheet).toBeVisible();

      // Deliver a real desktop resize, then resize the iframe back before native MQL notification.
      const result = await sheet.evaluate(async (element, reopen) => {
        const viewport = window.frameElement;
        if (
          !(element instanceof HTMLDialogElement) ||
          !element.matches(":modal") ||
          !viewport
        )
          throw new Error("Missing open menu or fixture viewport");
        const query = matchMedia("(width >= 64rem)");
        const changes: boolean[] = [];
        let wide = false,
          oldStillModal = false,
          closed = false;
        const record = (event: MediaQueryListEvent) => {
          changes.push(event.matches);
        };
        const reverse = () => {
          wide = query.matches;
          viewport.setAttribute("style", "width:390px;height:844px;border:0");
          void document.documentElement.clientWidth;
          oldStillModal = element.open && element.matches(":modal");
          if (reopen) {
            const close = element.querySelector("button[aria-label=Закрыть]");
            const trigger = document.querySelector(
              "button[aria-haspopup=dialog][aria-expanded=true]",
            );
            if (!close || !trigger) throw new Error("Missing More controls");
            close.dispatchEvent(new Event("fixture-click", { bubbles: true }));
            closed = !element.open;
            trigger.dispatchEvent(
              new Event("fixture-click", { bubbles: true }),
            );
          }
        };
        query.addEventListener("change", record);
        window.addEventListener("resize", reverse, { once: true });
        try {
          viewport.setAttribute("style", "width:1440px;height:844px;border:0");
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                resolve();
              }),
            ),
          );
          return {
            wide,
            oldStillModal,
            closed,
            changes,
            open: element.open,
            modal: element.matches(":modal"),
          };
        } finally {
          query.removeEventListener("change", record);
          window.removeEventListener("resize", reverse);
        }
      }, reopen);
      ui(result).toEqual({
        wide: true,
        oldStillModal: true,
        closed: reopen,
        changes: [false],
        open: reopen,
        modal: reopen,
      });
      if (reopen) {
        await page.keyboard.press("Escape");
        await ui(trigger).toBeFocused();
      }
      await ui(trigger).toHaveAttribute("aria-expanded", "false");
    } finally {
      await page.close();
    }
  },
  30_000,
);
