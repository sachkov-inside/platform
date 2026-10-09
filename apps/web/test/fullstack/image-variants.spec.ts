import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const variantIds = z.object({
  wideLight: z.uuid(),
  wideDark: z.uuid(),
  tallLight: z.uuid(),
  tallDark: z.uuid(),
});

async function verifyDiagram(
  page: Page,
  ids: z.infer<typeof variantIds>,
  narrow: boolean,
) {
  const image = page.getByRole("img", { name: "Схема вариантов" });
  const figure = page.locator("figure").filter({ has: image });
  const loaded = async (id: string) => {
    await expect(image).toHaveAttribute("src", new RegExp(id, "u"));
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
  };
  await loaded(narrow ? ids.tallLight : ids.wideLight);
  await figure.evaluate((node) => {
    node.classList.add("dark");
  });
  await loaded(narrow ? ids.tallDark : ids.wideDark);
  await page
    .getByRole("button", {
      name: "Открыть изображение крупно: Схема вариантов",
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Схема вариантов, просмотр крупно",
  });
  await expect(dialog.getByRole("img")).toHaveAttribute(
    "src",
    new RegExp(narrow ? ids.tallDark : ids.wideDark, "u"),
  );
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await figure.evaluate((node) => {
    node.classList.remove("dark");
  });
  await loaded(narrow ? ids.tallLight : ids.wideLight);
  if (!narrow) {
    await figure.evaluate((node) => {
      node.style.width = "50%";
    });
    await loaded(ids.tallLight);
    await figure.evaluate((node) => {
      node.style.width = "100%";
    });
    await loaded(ids.wideLight);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("imported Material and Task c diagrams follow column width and theme with zoom (#1195)", async ({
  page,
}, testInfo) => {
  const product = process.env["FULLSTACK_TASK_C_PRODUCT_SLUG"];
  const code = process.env["FULLSTACK_TASK_C_CODE"];
  if (product === undefined || code === undefined)
    throw new Error("Missing synthetic Task fixture");
  const task = variantIds.parse(
    JSON.parse(
      process.env["FULLSTACK_TASK_IMAGE_VARIANTS"] ?? "null",
    ) as unknown,
  );
  const material = variantIds.parse(
    JSON.parse(
      process.env["FULLSTACK_MATERIAL_IMAGE_VARIANTS"] ?? "null",
    ) as unknown,
  );
  const narrow = (testInfo.project.use.viewport?.width ?? 1440) < 560;
  await page.goto(`/products/${product}/tasks/${code}`);
  await verifyDiagram(page, task, narrow);
  const lesson = await page
    .getByRole("link", { name: "уроку", exact: true })
    .getAttribute("href");
  if (lesson === null) throw new Error("Missing lesson link");
  await page.goto(lesson);
  await verifyDiagram(page, material, narrow);
});
