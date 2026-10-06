import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";

import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

const headerHeight = 64;
const contentHeight = 3_000;

/**
 * Оболочка приложения: с `lg` (1024px) высота закреплена и прокручивается `#content`; уже — страница
 * прокручивается обычно. Оболочка авторинга делает то же с `md` (768px) и `#authoring-content`.
 */
function shell(main: string) {
  return `<!doctype html>
<style>
  * { box-sizing: border-box; margin: 0; }
  header { height: ${String(headerHeight)}px; background: #ddd; }
  .tall { height: ${String(contentHeight)}px; background: linear-gradient(#fff, #000); }
  @media (min-width: 1024px) {
    body.application { display: flex; flex-direction: column; height: 100vh; }
    #content { flex: 1; min-height: 0; overflow-y: auto; }
  }
  @media (min-width: 768px) {
    body.authoring { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    #authoring-content { flex: 1; min-height: 0; overflow-y: auto; }
  }
</style>
${main}`;
}

const applicationPage = shell(
  `<body class="application"><header></header><main id="content"><div class="tall"></div></main></body>`,
);
const authoringPage = shell(
  `<body class="authoring"><header></header><main id="authoring-content"><div class="tall"></div></main></body>`,
);

/** Высота PNG из заголовка IHDR: она идёт после подписи и длины, типа и ширины блока. */
function pngHeight(image: Buffer) {
  return image.readUInt32BE(20);
}

async function capture(
  html: string,
  viewport: { width: number; height: number },
) {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.setContent(html);
    const image = await screenshotWholePage(page);
    return { height: pngHeight(image), viewport: page.viewportSize() };
  } finally {
    await context.close();
  }
}

it("captures the whole #content scroll container on desktop and restores the viewport", async () => {
  const viewport = { width: 1_440, height: 1_024 };
  const result = await capture(applicationPage, viewport);

  expect(result.height).toBe(headerHeight + contentHeight);
  expect(result.viewport).toEqual(viewport);
});

it("captures the whole #authoring-content scroll container from md", async () => {
  for (const width of [800, 1_440]) {
    const result = await capture(authoringPage, { width, height: 1_024 });

    expect(result.height).toBe(headerHeight + contentHeight);
  }
});

it("captures the ordinary page scroll below lg", async () => {
  const viewport = { width: 390, height: 844 };
  const result = await capture(applicationPage, viewport);

  expect(result.height).toBe(headerHeight + contentHeight);
  expect(result.viewport).toEqual(viewport);
});

it("keeps one screen when the content fits", async () => {
  const result = await capture(
    shell(
      `<body class="application"><header></header><main id="content"><div style="height: 200px"></div></main></body>`,
    ),
    { width: 1_440, height: 1_024 },
  );

  expect(result.height).toBe(1_024);
});

it("fails instead of cutting the page when the content grows with the viewport", async () => {
  const viewport = { width: 1_440, height: 1_024 };
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.setContent(
      shell(
        `<body class="application"><header></header><main id="content"><div style="height: calc(100vh + 100px)"></div></main></body>`,
      ),
    );

    await expect(screenshotWholePage(page)).rejects.toThrow(
      /content grows with the viewport/u,
    );
    expect(page.viewportSize()).toEqual(viewport);
  } finally {
    await context.close();
  }
});
