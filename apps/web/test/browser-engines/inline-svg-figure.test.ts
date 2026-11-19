import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { captureWebkitFailureDiagnostics } from "../support/webkit-failure-diagnostics";

import { checkInlineSvgMarkup } from "@inside/material-blocks/svg-image";
import { type Browser, chromium, webkit } from "@playwright/test";
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
    const directory = resolve(
      import.meta.dirname,
      "../../test-results/browser-engines/inline-svg",
      engine.name(),
    );
    await rm(directory, { recursive: true, force: true });
    const capture =
      engine === webkit ? captureWebkitFailureDiagnostics() : undefined;
    const started = performance.now();
    let launchedBrowser: Browser | undefined;
    let closeStarted: number | undefined;
    let pendingStep: string | null = null;
    let bodyPendingStep: string | null = null;
    const steps: { name: string; milliseconds: number }[] = [];
    const step = async <T>(
      name: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      pendingStep = name;
      const before = performance.now();
      const value = await operation();
      steps.push({ name, milliseconds: performance.now() - before });
      pendingStep = null;
      return value;
    };
    // Registered before close: Vitest runs cleanup hooks in reverse order, including after timeout.
    t.onTestFinished(() => capture?.restore());
    // onTestFailed runs after cleanup hooks, so it also observes a browser.close hook timeout.
    t.onTestFailed(async () => {
      capture?.restore();
      const observedAt = performance.now();
      const webkitClose = capture && {
        phase: "onTestFailed-after-restore",
        millisecondsSinceCloseStart:
          closeStarted === undefined ? "unknown" : observedAt - closeStarted,
        clientConnected: launchedBrowser?.isConnected() ?? "unknown",
        ...capture.processObservation(),
      };
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(
          resolve(directory, "failure.json"),
          JSON.stringify(
            {
              engine: engine.name(),
              webkitClose,
              pendingStep,
              bodyPendingStep,
              elapsedMilliseconds: performance.now() - started,
              steps,
              resources: await capture?.snapshot(),
            },
            null,
            2,
          ),
        );
        if (capture !== undefined)
          await writeFile(
            resolve(directory, "webkit-log.json"),
            JSON.stringify(capture.logs(), null, 2),
          );
      } catch (error) {
        console.error(
          "[inline-svg diagnostics unavailable]",
          error instanceof Error ? error.name : "unknown",
        );
      }
    });
    const browser = await step("launch", () =>
      engine.launch({ headless: true }),
    );
    launchedBrowser = browser;
    t.onTestFinished(() => {
      closeStarted = performance.now();
      bodyPendingStep = pendingStep;
      return step("close", () => browser.close());
    });
    const page = await step("new-page", () =>
      browser.newPage({
        viewport: { height: 800, width: 1280 },
      }),
    );
    await step("set-content", () =>
      page.setContent(
        `<style>text{fill:rgb(0,128,0)}</style>
      <p id="page-text" style="margin:0;height:40px">Текст страницы</p>
      <div style="position:relative;width:400px;aspect-ratio:400/200">
        <div style="position:absolute;inset:0;overflow:hidden;contain:strict">
          <div id="escape" style="width:100%;height:100%"></div>
        </div>
      </div>
      <div id="loop" style="--fig-play:paused;width:720px;height:240px"></div>`,
      ),
    );
    const observed = await step("evaluate", () =>
      page.evaluate(
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
      ),
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
