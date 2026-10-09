import type { RenderedBlock } from "@inside/material-blocks";
import { expect, userEvent, waitFor, within } from "storybook/test";

export const variantDiagram: Extract<RenderedBlock, { kind: "image" }> = {
  kind: "image",
  assetId: "wideLight.png",
  alt: "Схема вариантов",
  caption: "Запрос, проверка, результат",
  sourceSrc: "assets/scene-wide-light.png",
  width: 960,
  height: 420,
  variants: [{ width: 960, height: 420 }],
  imageVariants: {
    wideLight: {
      assetId: "wideLight.png",
      width: 960,
      height: 420,
      variants: [{ width: 960, height: 420 }],
    },
    wideDark: {
      assetId: "wideDark.png",
      width: 960,
      height: 420,
      variants: [{ width: 960, height: 420 }],
    },
    tallLight: {
      assetId: "tallLight.png",
      width: 420,
      height: 900,
      variants: [{ width: 420, height: 900 }],
    },
    tallDark: {
      assetId: "tallDark.png",
      width: 420,
      height: 900,
      variants: [{ width: 420, height: 900 }],
    },
  },
};

/** Theme and column changes are observed through the loaded image and the existing zoom viewer. */
export async function expectVariantDiagram(
  canvasElement: HTMLElement,
  mobile: boolean,
) {
  const canvas = within(canvasElement);
  const root = canvasElement.ownerDocument.documentElement;
  const image = canvas.getByRole("img", { name: "Схема вариантов" });
  const loaded = async (variant: string) => {
    await waitFor(async () => {
      const image = canvas.getByRole("img", { name: "Схема вариантов" });
      await expect(image).toHaveAttribute(
        "src",
        expect.stringContaining(variant),
      );
      await expect(image).toHaveProperty("complete", true);
      await expect(image).not.toHaveProperty("naturalWidth", 0);
    });
  };
  const figure = image.closest("figure");
  if (figure === null) throw new Error("Diagram has no figure");
  const originalWidth = figure.style.width;
  try {
    await loaded(mobile ? "tallLight" : "wideLight");
    figure.classList.add("dark");
    await loaded(mobile ? "tallDark" : "wideDark");
    if (!mobile) {
      figure.style.width = "50%";
      await loaded("tallDark");
      figure.style.width = originalWidth;
      await loaded("wideDark");
    }
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Открыть изображение крупно: Схема вариантов",
      }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: "Схема вариантов, просмотр крупно",
    });
    await waitFor(async () => {
      await expect(within(dialog).getByRole("img")).toHaveAttribute(
        "src",
        expect.stringContaining(mobile ? "tallDark" : "wideDark"),
      );
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть" }),
    );
    figure.classList.remove("dark");
    await loaded(mobile ? "tallLight" : "wideLight");
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    figure.dataset["variantProof"] = "complete";
  } finally {
    figure.classList.remove("dark");
    figure.style.width = originalWidth;
  }
}
