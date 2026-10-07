import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

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
  prepare?: (page: Page) => Promise<unknown>,
) {
  return withPage(html, viewport, async (page) => {
    await prepare?.(page);
    const image = await screenshotWholePage(page);
    return { height: pngHeight(image), viewport: page.viewportSize() };
  });
}

async function withPage<Result>(
  html: string,
  viewport: { width: number; height: number },
  run: (page: Page) => Promise<Result>,
) {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.setContent(html);
    return await run(page);
  } finally {
    await context.close();
  }
}

/** Подменённый отказ не должен оставлять в логе CI предупреждение о настоящем повторе. */
function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/** Отказ Chromium из CI run 37546921993 (#1029): копия кадра не пришла после его собственных повторов. */
const chromiumCaptureFailure = new Error(
  "page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
);

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

it("waits for a running CSS transition before it measures the container", async () => {
  // #1035: `html { font-size: 200% }` перед снимком, а кнопки с `transition-all` растут в rem
  // ещё 150ms. Здесь высота прыгает к новой только в конце перехода: замер без ожидания видит
  // старую высоту, пока растяжение окна и новый замер занимают меньше секунды.
  const growRem = 100;
  const rootFontSize = 32;
  const result = await capture(
    shell(
      `<style>.grow { height: ${String(growRem)}rem; transition: height 1s step-end; }</style>
<body class="application"><header></header><main id="content"><div class="grow"></div></main></body>`,
    ),
    { width: 1_440, height: 1_024 },
    (page) =>
      page.addStyleTag({
        content: `html { font-size: ${String(rootFontSize)}px; }`,
      }),
  );

  expect(result.height).toBe(headerHeight + growRem * rootFontSize);
  expect(result.viewport).toEqual({ width: 1_440, height: 1_024 });
});

it("takes the capture again when Chromium cannot copy the frame", async () => {
  const viewport = { width: 390, height: 844 };
  await withPage(applicationPage, viewport, async (page) => {
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockRejectedValueOnce(chromiumCaptureFailure);
    const warn = silenceWarnings();

    const image = await screenshotWholePage(page);

    expect(pngHeight(image)).toBe(headerHeight + contentHeight);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Chromium could not copy the frame"),
    );
  });
});

it("restores the viewport when the stretched capture is taken again", async () => {
  const viewport = { width: 1_440, height: 1_024 };
  await withPage(applicationPage, viewport, async (page) => {
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockRejectedValueOnce(chromiumCaptureFailure);
    silenceWarnings();

    const image = await screenshotWholePage(page);

    expect(pngHeight(image)).toBe(headerHeight + contentHeight);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(page.viewportSize()).toEqual(viewport);
  });
});

it("waits for a readable compositor frame before repeating a refused capture", async () => {
  const viewport = { width: 1_440, height: 1_024 };
  await withPage(applicationPage, viewport, async (page) => {
    const context = page.context();
    const newSession = context.newCDPSession.bind(context);
    let frameCopied = false;
    vi.spyOn(context, "newCDPSession").mockImplementation(async (target) => {
      const session = await newSession(target);
      session.on("Page.screencastFrame", () => {
        frameCopied = true;
      });
      return session;
    });
    const captureFrame = page.screenshot.bind(page);
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockImplementation((options) =>
        frameCopied
          ? captureFrame(options)
          : Promise.reject(chromiumCaptureFailure),
      );
    silenceWarnings();

    const image = await screenshotWholePage(page);

    expect(pngHeight(image)).toBe(headerHeight + contentHeight);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(page.viewportSize()).toEqual(viewport);
  });
});

it("restores the viewport and detaches CDP when the frame request fails", async () => {
  const viewport = { width: 1_440, height: 1_024 };
  await withPage(applicationPage, viewport, async (page) => {
    const context = page.context();
    const session = await context.newCDPSession(page);
    vi.spyOn(context, "newCDPSession").mockResolvedValue(session);
    const unavailable = new Error("The compositor frame request failed");
    vi.spyOn(session, "send").mockRejectedValueOnce(unavailable);
    const detach = vi.spyOn(session, "detach");
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockRejectedValue(chromiumCaptureFailure);
    silenceWarnings();

    await expect(screenshotWholePage(page)).rejects.toBe(unavailable);

    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(page.viewportSize()).toEqual(viewport);
  });
});

it("bounds a missing compositor frame and restores the viewport", async () => {
  const viewport = { width: 1_440, height: 1_024 };
  await withPage(applicationPage, viewport, async (page) => {
    const context = page.context();
    const session = await context.newCDPSession(page);
    vi.spyOn(context, "newCDPSession").mockResolvedValue(session);
    // Протокол принял запрос, но компоновщик не прислал ни одного кадра.
    vi.spyOn(session, "send").mockResolvedValueOnce({});
    const detach = vi.spyOn(session, "detach");
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockRejectedValue(chromiumCaptureFailure);
    silenceWarnings();

    await expect(screenshotWholePage(page)).rejects.toThrow(
      "Chromium did not copy a compositor frame within 10000ms",
    );

    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(page.viewportSize()).toEqual(viewport);
  });
}, 15_000);

it("gives up after three refused captures", async () => {
  await withPage(applicationPage, { width: 390, height: 844 }, async (page) => {
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockRejectedValue(chromiumCaptureFailure);
    silenceWarnings();

    await expect(screenshotWholePage(page)).rejects.toBe(
      chromiumCaptureFailure,
    );
    expect(screenshot).toHaveBeenCalledTimes(3);
  });
});

it("does not take the capture again after another failure", async () => {
  await withPage(applicationPage, { width: 390, height: 844 }, async (page) => {
    const closed = new Error(
      "page.screenshot: Target page, context or browser has been closed",
    );
    const screenshot = vi
      .spyOn(page, "screenshot")
      .mockRejectedValueOnce(closed);

    await expect(screenshotWholePage(page)).rejects.toBe(closed);
    expect(screenshot).toHaveBeenCalledTimes(1);
  });
});
