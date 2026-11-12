import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkInlineSvgMarkup } from "@inside/material-blocks/svg-image";
import { chromium, webkit } from "@playwright/test";
import { test } from "vitest";

declare global {
  /** Non-standard find in page; Chromium, WebKit and Firefox implement it. */
  interface Window {
    find(text: string): boolean;
  }
}

/**
 * Reader puts a checked SVG figure into the page's DOM rather than a shadow root (#2041): WebKit's
 * find in page skips shadow trees. This contract runs the same placement as
 * `MaterialSvgFigure` in Chromium and WebKit: the text is found and selected, `--fig-play`
 * reaches the animation, and a frame with `contain: strict` keeps a figure that targets its own
 * root with `position: fixed` from covering the page.
 */
const fixture = (name: string) => {
  const checked = checkInlineSvgMarkup(
    readFileSync(
      new URL(`../../.storybook/fixtures/svg-figures/${name}`, import.meta.url),
      "utf8",
    ),
  );
  assert.ok(checked.ok, name);
  return checked.value.markup;
};

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} finds figure text, pauses its animation and keeps it in its frame`, async (t) => {
    const browser = await engine.launch({ headless: true });
    t.onTestFinished(() => browser.close());
    const page = await browser.newPage({
      viewport: { height: 800, width: 1280 },
    });
    await page.setContent(
      `<style>text{fill:rgb(0,128,0)}</style>
      <p id="page-text" style="margin:0;height:40px">Текст страницы</p>
      <div style="position:relative;width:400px;aspect-ratio:400/200">
        <div style="position:absolute;inset:0;overflow:hidden;contain:strict">
          <div id="escape" style="width:100%;height:100%"></div>
        </div>
      </div>
      <div id="loop" style="--fig-play:paused;width:720px;height:240px"></div>`,
    );
    const observed = await page.evaluate(
      ([loop, escape]) => {
        const place = (hostId: string, markup: string) => {
          const parsed = new DOMParser().parseFromString(
            markup,
            "image/svg+xml",
          );
          const svg = document.importNode(parsed.documentElement, true);
          svg.setAttribute("aria-hidden", "true");
          document.getElementById(hostId)?.replaceChildren(svg);
        };
        place("loop", loop ?? "");
        place("escape", escape ?? "");
        const step = document.querySelector("#fig-agent-loop-wide .step");
        const words = document
          .getElementById("page-text")
          ?.getBoundingClientRect();
        const hit =
          words === undefined
            ? null
            : document.elementFromPoint(
                words.left + 4,
                words.top + words.height / 2,
              );
        const paused =
          step === null ? "" : getComputedStyle(step).animationPlayState;
        document
          .getElementById("loop")
          ?.style.setProperty("--fig-play", "running");
        const running =
          step === null ? "" : getComputedStyle(step).animationPlayState;
        const escapeText = document.querySelector("#fig-escape-wide text");
        return {
          found: window.find("Проверка"),
          selected: String(window.getSelection()),
          paused,
          running,
          pageReceivesPointer: hit?.id === "page-text",
          figureTextFill:
            escapeText === null ? "" : getComputedStyle(escapeText).fill,
        };
      },
      [fixture("wide/720"), fixture("hostile/400")],
    );
    assert.deepEqual(observed, {
      found: true,
      selected: "Проверка",
      paused: "paused",
      running: "running",
      pageReceivesPointer: true,
      figureTextFill: "rgb(17, 24, 39)",
    });
  });
}
