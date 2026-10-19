import { expect, test } from "@playwright/test";

test("читатель делится постоянным адресом без личного контекста", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: ShareData) => {
        document.documentElement.dataset["sharedMaterial"] =
          JSON.stringify(data);
        return Promise.resolve();
      },
    });
  });
  await page.goto(
    "/materials/navigation-lesson-1?utm_source=telegram&view=reference",
  );
  await page
    .getByRole("button", {
      name: "Поделиться материалом «Первый бесплатный урок»",
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-shared-material",
    JSON.stringify({
      title: "Первый бесплатный урок",
      url: `${String(baseURL)}/materials/navigation-lesson-1`,
    }),
  );
});

test("при запрете clipboard остаётся доступный адрес для ручного копирования", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    });
  });
  await page.goto("/materials/navigation-lesson-3?from=%2Flibrary");
  await page.getByRole("button", { name: /^Поделиться материалом/ }).click();
  await expect(
    page.getByRole("textbox", { name: /Скопируйте ссылку/ }),
  ).toHaveValue(`${String(baseURL)}/materials/navigation-lesson-3`);
});
