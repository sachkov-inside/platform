import { expect, test, type Page } from "@playwright/test";
const image = {
  name: "diagram.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
};
async function createDraft(page: Page, suffix: string) {
  await page.goto("/authoring/materials/new");
  await page
    .getByLabel("Название", { exact: true })
    .fill(`Редактор ${suffix} ${String(Date.now())}`);
  await expect(page).toHaveURL(/materials\/[a-f0-9-]{36}/u);
  await saved(page);
}
async function saved(page: Page) {
  await expect(page.locator("header [role=status]")).toContainText("Сохранено");
}

test("autosave serializes edits made during a request and replays an uncertain receipt before newer edits", async ({
  page,
}) => {
  await createDraft(page, "очередь");
  let release: (() => void) | undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let first = true;
  await page.route("**/api/authoring/materials", async (route) => {
    if (route.request().method() === "PUT" && first) {
      first = false;
      await gate;
    }
    await route.continue();
  });
  const body = page.locator("[contenteditable=true]");
  const started = page.waitForRequest((request) => request.method() === "PUT");
  await body.fill("Первая правка");
  await started;
  await body.fill("Вторая правка во время сохранения");
  release?.();
  await saved(page);
  await page.reload();
  await expect(body).toContainText("Вторая правка во время сохранения");
  await page.unroute("**/api/authoring/materials");
  const attempts: string[] = [];
  let loseReceipt = true;
  await page.route("**/api/authoring/materials", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    attempts.push(route.request().postData() ?? "");
    if (loseReceipt) {
      loseReceipt = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await body.fill("Ответ сервера потерян");
  await expect(
    page.getByText("Не удалось сохранить материал", { exact: true }),
  ).toBeVisible();
  await body.fill("Новая правка после сетевой ошибки");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await saved(page);
  // Same idempotency key and content replay; multipart boundaries may differ.
  const keys = attempts.map(
    (attempt) => /name="submissionId"\r\n\r\n([^\r]+)/u.exec(attempt)?.[1],
  );
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  await page.reload();
  await expect(body).toContainText("Новая правка после сетевой ошибки");
});

test("images, files and ready video persist automatically; fullscreen preserves the editor", async ({
  page,
}) => {
  await createDraft(page, "вложения");
  await page
    .getByLabel("Выбрать изображения", { exact: true })
    .setInputFiles(image);
  await expect(page.locator("[contenteditable=true] img")).toBeVisible();
  await page.getByLabel("Выбрать файлы", { exact: true }).setInputFiles({
    name: "guide.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Guide attachment"),
  });
  await expect(page.getByLabel("Название вложения")).toHaveValue("guide.txt");
  await saved(page);
  await page
    .getByRole("button", { name: "На весь экран", exact: true })
    .click();
  await expect(page.locator("dialog:modal")).toHaveAttribute(
    "aria-label",
    "Редактор статьи",
  );
  await page
    .getByLabel("Подпись изображения")
    .fill("Подпись в полноэкранном режиме");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog:modal")).toHaveCount(0);
  await page.getByLabel("Видео для загрузки").setInputFiles({
    name: "test-video.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("local video provider fixture"),
  });
  await expect(page.getByText("Видео готово", { exact: true })).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("Подпись изображения")).toHaveValue(
    "Подпись в полноэкранном режиме",
  );
  await expect(page.getByLabel("Название вложения")).toHaveValue("guide.txt");
  await expect(page.getByText("test-video", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("[contenteditable=true] img")
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "/tmp/396-editor-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: "/tmp/396-editor-mobile.png", fullPage: true });
});

test("series picker shows materials before typing and saves composition on the same page", async ({
  page,
}) => {
  await createDraft(page, "для серии");
  await page.goto("/authoring/playlists");
  await page.getByRole("button", { name: "Создать серию" }).click();
  const name = `Серия ${String(Date.now())}`;
  await page.getByLabel("Название", { exact: true }).fill(name);
  await page
    .getByLabel("Адрес", { exact: false })
    .fill(`series-${String(Date.now())}`);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  const row = page.getByRole("article").filter({ hasText: name });
  await row.getByRole("button", { name: new RegExp(name, "u") }).click();
  await row
    .getByRole("button", { name: "Материалы серии", exact: true })
    .click();
  await row
    .getByRole("button", { name: "Добавить материал", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Добавить материал",
    exact: true,
  });
  await expect(picker.getByRole("searchbox")).toHaveValue("");
  const add = picker.getByRole("button", { name: /^Добавить «/u }).first();
  await expect(add).toBeVisible();
  const title = (await add.getAttribute("aria-label"))?.replace(
    /^Добавить «|»$/gu,
    "",
  );
  await add.click();
  await picker.getByRole("button", { name: "Закрыть выбор материала" }).click();
  await expect(
    row.getByText("Порядок сохранён.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/authoring\/playlists$/u);
  await page.reload();
  await page
    .getByRole("article")
    .filter({ hasText: name })
    .getByRole("button", { name: new RegExp(name, "u") })
    .click();
  await page
    .getByRole("button", { name: "Материалы серии", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Материалы серии" }),
  ).toContainText(title ?? "");
});

test("cover drop and paste persist immediately; article paste inserts an image", async ({
  page,
}) => {
  await createDraft(page, "буфер");
  const cover = page.getByRole("region", { name: /^Обложка:/u });
  async function transfer(selector: string, kind: "drop" | "paste") {
    await page.locator(selector).evaluate(
      (element, input) => {
        const bytes = Uint8Array.from(atob(input.base64), (value) =>
          value.charCodeAt(0),
        );
        const data = new DataTransfer();
        data.items.add(
          new File([bytes], `clipboard-${input.kind}.png`, {
            type: "image/png",
          }),
        );
        const event =
          input.kind === "paste"
            ? new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: data,
              })
            : new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer: data,
              });
        element.dispatchEvent(event);
      },
      { kind, base64: image.buffer.toString("base64") },
    );
  }
  await transfer('section[aria-label^="Обложка:"]', "drop");
  await expect(cover.getByText("Обложка обновлена.")).toBeVisible();
  const firstSource = await cover.locator("img").getAttribute("src");
  await page.reload();
  await expect(cover.locator("img")).toHaveAttribute("src", firstSource ?? "");
  await transfer('section[aria-label^="Обложка:"]', "paste");
  await expect(cover.getByText("Обложка обновлена.")).toBeVisible();
  await transfer("[contenteditable=true]", "paste");
  await expect(page.locator("[contenteditable=true] img")).toBeVisible();
  await saved(page);
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("[contenteditable=true] img")
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
});

test("tables, callouts and links survive autosave and reopening", async ({
  page,
}) => {
  await createDraft(page, "блоки");
  const body = page.locator("[contenteditable=true]");
  await body.fill("Текст перед таблицей");
  await body.press("End");
  await body.press("Enter");
  await page
    .getByRole("button", { name: "Добавить блок", exact: true })
    .click();
  await page.getByRole("button", { name: "Таблица", exact: true }).click();
  await body.locator("th").first().click();
  await page.keyboard.type("Столбец");
  await saved(page);
  await page.reload();
  await expect(body.locator("table")).toContainText("Столбец");
  await body.press("ControlOrMeta+End");
  await page
    .getByRole("button", { name: "Добавить блок", exact: true })
    .click();
  await page.getByRole("button", { name: "Примечание", exact: true }).click();
  await body.locator("aside p").click();
  await page.keyboard.type("Примечание автора");
  await saved(page);
  await page
    .getByRole("button", { name: "Добавить блок", exact: true })
    .click();
  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  await page.getByLabel("Адрес ссылки").fill("https://example.com/guide");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(body.locator("table")).toContainText("Столбец");
  await expect(body.locator("aside")).toContainText("Примечание автора");
  await expect(body.locator("a")).toHaveAttribute(
    "href",
    "https://example.com/guide",
  );
});
