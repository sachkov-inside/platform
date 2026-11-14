import type { RenderedBlock } from "@inside/material-blocks";
import { expect, userEvent, waitFor, within } from "storybook/test";

type ImageBlock = Extract<RenderedBlock, { kind: "image" }>;

const wide = {
  assetId: "figure-wide.svg",
  format: "svg",
  height: 240,
  variants: [{ height: 240, width: 720 }],
  width: 720,
} as const;
const tall = {
  assetId: "figure-tall.svg",
  format: "svg",
  height: 420,
  variants: [{ height: 420, width: 360 }],
  width: 360,
} as const;

/** A wide/tall SVG pair as Content Studio delivers it: one file in both theme keys (#2041). */
export const svgFigurePair: ImageBlock = {
  kind: "image",
  alt: "Цикл агента: запрос, проверка, результат",
  caption: "Агент проверяет каждый шаг",
  sourceSrc: "assets/agent-loop-wide.svg",
  ...wide,
  imageVariants: {
    wideLight: wide,
    wideDark: wide,
    tallLight: tall,
    tallDark: tall,
  },
};

/** A scoped figure whose rule on its own root tries to cover the whole page. */
export const hostileSvgFigure: ImageBlock = {
  kind: "image",
  alt: "Выход за рамку",
  assetId: "figure-hostile.svg",
  format: "svg",
  height: 200,
  variants: [{ height: 200, width: 400 }],
  width: 400,
};

/** A file without a figure id whose CSS restyles the page: it stays an `<img>`. */
export const unscopedSvgFigure: ImageBlock = {
  kind: "image",
  alt: "Чужие правила",
  assetId: "figure-unscoped.svg",
  format: "svg",
  height: 200,
  variants: [{ height: 200, width: 400 }],
  width: 400,
};

/** A stored file that fails the browser's own check: it never enters the page as markup. */
export const unsafeSvgFigure: ImageBlock = {
  kind: "image",
  alt: "Скрипт",
  assetId: "figure-unsafe.svg",
  format: "svg",
  height: 200,
  variants: [{ height: 200, width: 400 }],
  width: 400,
};

/**
 * With reduced motion the figure shows its final frame and runs no animation; otherwise its
 * animated rules follow `--fig-play`.
 */
async function expectAnimation(step: Element, play: "paused" | "running") {
  const view = step.ownerDocument.defaultView;
  if (view?.matchMedia("(prefers-reduced-motion: reduce)").matches === true) {
    await expect(getComputedStyle(step).animationName).toBe("none");
    await expect(getComputedStyle(step).opacity).toBe("1");
    return;
  }
  await expect(getComputedStyle(step).animationPlayState).toBe(play);
}

async function inlineFigure(canvasElement: HTMLElement, name: string) {
  const canvas = within(canvasElement);
  let host: HTMLElement | undefined;
  await waitFor(async () => {
    host = canvas.getByRole("img", { name });
    await expect(host.querySelector(":scope > svg")).not.toBeNull();
  });
  if (host === undefined) throw new Error("Figure is not inline");
  return { host, root: host };
}

/**
 * The figure is markup in the page: the column picks the layout, the text is text, the animation
 * runs once visible, and the viewer shows the same checked SVG.
 */
export async function expectSvgFigure(
  canvasElement: HTMLElement,
  mobile: boolean,
) {
  const canvas = within(canvasElement);
  const root = canvasElement.ownerDocument.documentElement;
  const layout = async (expected: "wide" | "tall") => {
    await waitFor(async () => {
      const figure = await inlineFigure(canvasElement, svgFigurePair.alt);
      await expect(figure.root.querySelector("svg")?.id).toBe(
        `fig-agent-loop-${expected}`,
      );
      const composition = figure.host.closest(
        '[data-image-composition="variants"]',
      );
      if (composition === null) throw new Error("Missing composition");
      await expect(
        Math.abs(
          composition.getBoundingClientRect().height -
            figure.host.getBoundingClientRect().height,
        ),
      ).toBeLessThan(1);
    });
  };
  await layout(mobile ? "tall" : "wide");
  const { host, root: markup } = await inlineFigure(
    canvasElement,
    svgFigurePair.alt,
  );
  await expect(host.closest("img")).toBeNull();
  await expect(markup.textContent).toContain("Проверка");
  await waitFor(async () => {
    await expect(host.dataset["figPlay"]).toBe("running");
    const step = markup.querySelector(".step");
    if (step === null) throw new Error("Figure has no animated step");
    await expectAnimation(step, "running");
  });

  const figure = host.closest("figure");
  if (figure === null) throw new Error("Figure has no figure element");
  const originalWidth = figure.style.width;
  try {
    if (!mobile) {
      figure.style.width = "50%";
      await layout("tall");
      figure.style.width = originalWidth;
      await layout("wide");
    }
    const zoom = canvas.getByRole("button", {
      name: `Открыть изображение крупно: ${svgFigurePair.alt}`,
    });
    // The zoom control sits below the figure and never covers a corner of it.
    await expect(zoom).toBeVisible();
    await expect(zoom.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      host.getBoundingClientRect().bottom - 0.5,
    );
    // On a phone a tap on the figure itself opens it large instead of shrinking its text.
    await userEvent.click(mobile ? host : zoom);
    const dialog = await canvas.findByRole("dialog", {
      name: `${svgFigurePair.alt}, просмотр крупно`,
    });
    await waitFor(async () => {
      const image = within(dialog).getByRole("img");
      await expect(image).toHaveAttribute(
        "src",
        expect.stringMatching(/^blob:/u),
      );
      await expect(image).toHaveProperty("complete", true);
      await expect(image).not.toHaveProperty("naturalWidth", 0);
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть" }),
    );
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    figure.dataset["svgFigureProof"] = "complete";
  } finally {
    figure.style.width = originalWidth;
  }
}

/** A figure below the fold keeps its animation paused until the reader scrolls to it. */
export async function expectSvgFigureWaitsForReader(
  canvasElement: HTMLElement,
) {
  const { host, root } = await inlineFigure(canvasElement, svgFigurePair.alt);
  const step = root.querySelector(".step");
  if (step === null) throw new Error("Figure has no animated step");
  await expect(host.dataset["figPlay"]).toBe("paused");
  await expectAnimation(step, "paused");
  host.scrollIntoView({ block: "center" });
  await waitFor(async () => {
    await expect(host.dataset["figPlay"]).toBe("running");
    await expectAnimation(step, "running");
  });
}

/** A rule on the figure's root cannot draw it outside its frame; page rules do not restyle it. */
export async function expectSvgFigureIsolation(canvasElement: HTMLElement) {
  const document = canvasElement.ownerDocument;
  const pageStyle = document.createElement("style");
  pageStyle.textContent = "text{fill:rgb(0,128,0)}";
  document.head.append(pageStyle);
  try {
    const { host, root } = await inlineFigure(
      canvasElement,
      hostileSvgFigure.alt,
    );
    const paragraph = within(canvasElement).getByText("Текст страницы");
    const text = root.querySelector("text");
    if (text === null) throw new Error("Figure has no text");
    await expect(getComputedStyle(text).fill).not.toBe("rgb(0, 128, 0)");
    // The figure's `position: fixed` with `100vw` stays inside its frame: outside the frame the
    // page, not the figure, receives a pointer.
    const words = paragraph.getBoundingClientRect();
    const hit = document.elementFromPoint(
      words.left + 4,
      words.top + words.height / 2,
    );
    await expect(hit === host || host.contains(hit)).toBe(false);
    await expect(paragraph.contains(hit)).toBe(true);
  } finally {
    pageStyle.remove();
  }
}

/** Files that fail the browser's checks stay `<img>`: their CSS and script never reach the page. */
export async function expectUnsafeSvgFigureFallsBack(
  canvasElement: HTMLElement,
) {
  const figures = canvasElement.querySelectorAll("figure");
  await expect(figures).toHaveLength(2);
  for (const figure of figures)
    await waitFor(async () => {
      await expect(figure.querySelector("[data-svg-figure]")).toBeNull();
      await expect(figure.querySelector("img, [role='status']")).not.toBeNull();
    });
  const paragraph = within(canvasElement).getByText("Текст страницы");
  await expect(getComputedStyle(paragraph).color).not.toBe("rgb(255, 0, 0)");
  await expect(canvasElement.querySelector("figure svg text")).toBeNull();
  await expect(
    Reflect.get(
      canvasElement.ownerDocument.defaultView ?? {},
      "__svgFigureScriptRan",
    ),
  ).toBeUndefined();
}
