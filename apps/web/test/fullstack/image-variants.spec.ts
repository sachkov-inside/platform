import { expect, type Page } from "@playwright/test";
import { test } from "../support/image-failure-fixture";
import { signInFullStack } from "../support/full-stack-session";
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
    await expect(image).toHaveAttribute("srcset", /\d+w/u);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        image.evaluate((node) => {
          const composition = node.closest(
            '[data-image-composition="variants"]',
          );
          return composition === null
            ? Infinity
            : Math.abs(
                composition.getBoundingClientRect().height -
                  node.getBoundingClientRect().height,
              );
        }),
      )
      .toBeLessThan(1);
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
  await expect
    .poll(() =>
      dialog
        .getByRole("img")
        .evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
    )
    .toBe(true);
  const stage = dialog.getByTestId("image-viewer-stage");
  const box = await stage.boundingBox();
  if (box === null) throw new Error("Missing viewer stage geometry");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const scale = dialog.locator("output");
  await expect(scale).toHaveText("100%");
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -100);
  await expect(scale).toHaveText("122%");
  await page.keyboard.press("0");
  await expect(scale).toHaveText("100%");

  // Chromium delivers real touch/pointer events and capture; no own-module or browser API double.
  const touch = await page.context().newCDPSession(page);
  let touching = false;
  try {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: center.x - 40, y: center.y },
        { id: 2, x: center.x + 40, y: center.y },
      ],
    });
    touching = true;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: center.x - 80, y: center.y },
        { id: 2, x: center.x + 80, y: center.y },
      ],
    });
    await expect(scale).toHaveText("200%");
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    touching = false;
    await page.keyboard.press("0");
    await expect(scale).toHaveText("100%");
    // Fixed external-input timestamps model a real 150ms double tap, independent of CLI latency.
    const tapAtSeconds = 1_800_000_000;
    for (const offset of [0, 0.15]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        timestamp: tapAtSeconds + offset,
        touchPoints: [{ id: 1, x: center.x, y: center.y }],
      });
      touching = true;
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        timestamp: tapAtSeconds + offset + 0.05,
        touchPoints: [],
      });
      touching = false;
    }
    await expect(scale).toHaveText("250%");
  } finally {
    try {
      if (touching)
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
    } finally {
      await touch.detach();
    }
  }
  await page.keyboard.press("0");
  await expect(scale).toHaveText("100%");

  // Keep a real pointer down until after Next has hidden this retained reader/task.
  await stage.evaluate((node) => {
    node.addEventListener(
      "pointerdown",
      (event) => {
        node.dataset["heldPointer"] = String(event.pointerId);
      },
      { once: true },
    );
  });
  const capturedStage = await stage.elementHandle();
  const retainedDialog = await dialog.elementHandle();
  if (capturedStage === null || retainedDialog === null)
    throw new Error("Missing retained viewer nodes");
  const returnUrl = page.url();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  try {
    await expect
      .poll(() =>
        capturedStage.evaluate((node) =>
          node.hasPointerCapture(Number(node.dataset["heldPointer"])),
        ),
      )
      .toBe(true);
    await page
      .locator('a[href="/"]')
      .first()
      .evaluate((node: HTMLAnchorElement) => {
        node.click();
      });
    await page.waitForURL((url) => url.pathname === "/");
    await expect
      .poll(() => retainedDialog.evaluate((node) => node.hasAttribute("open")))
      .toBe(false);
    await expect(
      capturedStage.evaluate((node) => node.isConnected),
    ).resolves.toBe(true);
    await expect
      .poll(() =>
        capturedStage.evaluate((node) =>
          node.hasPointerCapture(Number(node.dataset["heldPointer"])),
        ),
      )
      .toBe(false);
  } finally {
    await page.mouse.up();
    await capturedStage.dispose();
    await retainedDialog.dispose();
  }
  await page.goBack();
  await expect(page).toHaveURL(returnUrl);
  await expect(dialog).toHaveAttribute("open", "");
  await expect
    .poll(() =>
      dialog
        .getByRole("img")
        .evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
    )
    .toBe(true);
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

async function verifyWithHydrationProof(
  page: Page,
  href: string,
  narrow: boolean,
  verify: () => Promise<void>,
) {
  let release = () => {
    /* Replaced synchronously by the promise executor. */
  };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/**/*.js*", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto(href, { waitUntil: "commit" });
    // The fixture caption differs by surface; the responsive composition itself is shared.
    const composition = page
      .locator('[data-image-composition="variants"]')
      .first();
    await expect(composition).toBeVisible();
    await expect
      .poll(async () => {
        const box = await composition.boundingBox();
        return box === null ? 0 : box.height / box.width;
      })
      .toBeCloseTo(narrow ? 900 / 420 : 420 / 960, 2);
    const before = await composition.boundingBox();
    release();
    await expect(
      page.getByRole("img", { name: "Схема вариантов" }),
    ).toBeVisible();
    const after = await composition.boundingBox();
    expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
    // Removing the last route disables Chromium interception. During a cross-origin image
    // redirect that can strand the redirected request before it reaches object storage (#1907).
    // Keep interception through image verification, then tear it down in finally.
    await verify();
  } finally {
    release();
    await page.unroute("**/_next/**/*.js*");
  }
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
  // The free lesson opens after Telegram sign-in (#1825); the reader is not the subject here.
  await signInFullStack(page.context());
  await verifyWithHydrationProof(
    page,
    `/products/${product}/tasks/${code}`,
    narrow,
    () => verifyDiagram(page, task, narrow),
  );
  const lesson = await page
    .getByRole("link", { name: "уроку", exact: true })
    .getAttribute("href");
  if (lesson === null) throw new Error("Missing lesson link");
  await verifyWithHydrationProof(page, lesson, narrow, () =>
    verifyDiagram(page, material, narrow),
  );
});
