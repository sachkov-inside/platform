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
    .getByRole("navigation", { name: "Действия материала", exact: true })
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
        writeText: () => {
          document.documentElement.dataset["clipboardCalls"] = String(
            Number(document.documentElement.dataset["clipboardCalls"] ?? "0") +
              1,
          );
          return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        },
      },
    });
  });
  await page.goto("/materials/navigation-lesson-1?from=%2Flibrary");
  await page
    .getByRole("navigation", {
      name: "Действия в конце материала",
      exact: true,
    })
    .getByRole("button", { name: /^Поделиться материалом/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: /Скопируйте ссылку/ }),
  ).toHaveValue(`${String(baseURL)}/materials/navigation-lesson-1`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-clipboard-calls",
    "1",
  );
});

test("кнопка обмена доступна только после подключения обработчика", async ({
  page,
  baseURL,
}) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  // Keep the server-rendered control on screen before any client code can hydrate it.
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => {
          document.documentElement.dataset["clipboardCalls"] = String(
            Number(document.documentElement.dataset["clipboardCalls"] ?? "0") +
              1,
          );
          return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        },
      },
    });
  });
  try {
    await page.goto("/materials/navigation-lesson-3?from=%2Flibrary", {
      waitUntil: "commit",
    });
    const share = page
      .getByRole("navigation", { name: "Действия материала", exact: true })
      .getByRole("button", { name: /^Поделиться материалом/ });
    await expect(share).toBeVisible();
    await expect(share).toBeDisabled();
    releaseScripts();
    // A single ordinary click waits on the control's own readiness, not page timing.
    await share.click();
    await expect(
      page.getByRole("textbox", { name: /Скопируйте ссылку/ }),
    ).toHaveValue(`${String(baseURL)}/materials/navigation-lesson-3`);
    await expect(page.locator("html")).toHaveAttribute(
      "data-clipboard-calls",
      "1",
    );
  } finally {
    releaseScripts();
  }
});
