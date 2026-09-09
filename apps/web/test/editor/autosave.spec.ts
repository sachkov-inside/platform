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
  await expect(page.locator("dialog:modal [role=status]")).toContainText(
    "Сохранено",
  );
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
  await createDraft(page, "для руководства");
  await page.goto("/authoring/guides");
  await page.getByRole("button", { name: "Создать руководство" }).click();
  const name = `Руководство ${String(Date.now())}`;
  await page.getByLabel("Название", { exact: true }).fill(name);
  await page
    .getByLabel("Адрес", { exact: false })
    .fill(`series-${String(Date.now())}`);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/authoring\/guides\/[^/]+$/u);
  await page.getByRole("button", { name: "Добавить материал", exact: true }).click();
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
    page.getByText("Порядок сохранён.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Материалы руководства" }),
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
  await body.locator(":scope > p").first().click();
  const editorOffset = () =>
    body.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        (element.closest("dialog")?.getBoundingClientRect().top ?? 0),
    );
  const beforeTableFocus = await editorOffset();
  await body.locator("th").first().click();
  expect(await editorOffset()).toBe(beforeTableFocus);
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

test("publication validation remains visible after background draft save", async ({
  page,
}) => {
  await createDraft(page, "публикация");
  await page
    .locator("[contenteditable=true]")
    .fill("Последняя правка перед публикацией");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByText("Не удалось опубликовать. Проверьте отмеченные поля."),
  ).toBeVisible();
  await saved(page);
  await expect(
    page.getByText("Не удалось опубликовать. Проверьте отмеченные поля."),
  ).toBeVisible();
  await expect(page.getByText(/Проверьте соединение/u)).toHaveCount(0);
  await expect(page.locator("header")).toContainText("Черновик");
  await page.reload();
  await expect(page.locator("[contenteditable=true]")).toContainText(
    "Последняя правка перед публикацией",
  );
});

test("a late video response cannot restore a video removed during processing", async ({
  page,
}) => {
  await createDraft(page, "отмена видео");
  let release: (() => void) | undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(
    "**/api/authoring/material-video-reconciliations",
    async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  const requested = page.waitForRequest(
    "**/api/authoring/material-video-reconciliations",
  );
  await page.getByLabel("Видео для загрузки").setInputFiles({
    name: "removed.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("Local test video"),
  });
  await requested;
  await page.getByRole("button", { name: "Убрать", exact: true }).click();
  const completed = page.waitForResponse(
    "**/api/authoring/material-video-reconciliations",
  );
  release?.();
  await completed;
  await expect(page.getByText("Основное видео не выбрано")).toBeVisible();
  await page
    .getByLabel("Краткое описание", { exact: true })
    .fill("Правка после отмены видео");
  await saved(page);
  await page.reload();
  await expect(page.getByText("Основное видео не выбрано")).toBeVisible();
});

test("paragraph controls insert at the hovered block without changing content on cancel", async ({
  page,
}) => {
  await createDraft(page, "абзацы");
  const body = page.locator(".ProseMirror");
  await body.fill("Первый абзац");
  await body.press("Enter");
  await page.keyboard.type("Последний абзац");
  const first = body.locator(":scope > p").first();
  await first.hover();
  const plus = page.getByRole("button", { name: "Добавить блок", exact: true });
  await expect
    .poll(async () =>
      Math.abs(
        ((await plus.boundingBox())?.y ?? Number.NaN) -
          ((await first.boundingBox())?.y ?? Number.NaN),
      ),
    )
    .toBeLessThan(2);
  const before = await body.innerHTML();
  await plus.click();
  await page.getByLabel("Найти блок").press("Escape");
  expect(await body.innerHTML()).toBe(before);
  await first.hover();
  await expect
    .poll(async () =>
      Math.abs(
        ((await plus.boundingBox())?.y ?? Number.NaN) -
          ((await first.boundingBox())?.y ?? Number.NaN),
      ),
    )
    .toBeLessThan(2);
  await plus.click();
  await page.getByRole("button", { name: "Заголовок H2", exact: true }).click();
  await page.keyboard.type("Между абзацами");
  await expect(body.locator(":scope > *")).toHaveText([
    "Первый абзац",
    "Между абзацами",
    "Последний абзац",
  ]);
  await saved(page);
  await page.reload();
  await expect(body.locator("h2")).toHaveText("Между абзацами");
  await body.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Найти блок")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Добавить блок", exact: true }),
  ).toBeHidden();
  await first.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.closest<HTMLElement>("[contenteditable]")?.focus();
  });
  await expect(
    page.getByRole("toolbar", { name: "Форматирование" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Полужирный" }).click();
  await expect(first.locator("strong")).toHaveText("Первый абзац");
  const typography = () =>
    body.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
  const smallTypography = await typography();
  await page
    .getByRole("button", { name: "На весь экран", exact: true })
    .click();
  expect(await typography()).toEqual(smallTypography);
  await body
    .locator("p")
    .last()
    .click({ position: { x: 2, y: 12 } });
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Найти блок")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog:modal")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog:modal")).toHaveCount(0);
});

test("image size survives reload and is used in preview; series are searchable without expanding", async ({
  page,
}) => {
  await createDraft(page, "размер изображения");
  await expect(
    page.getByRole("group", { name: "Теги", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Поиск руководств").fill("Нет такой руководства");
  await expect(page.getByText("Руководства не найдены")).toBeVisible();
  await page.getByLabel("Поиск руководств").fill("Demo");
  const series = page.getByLabel("Выбор руководств", { exact: true });
  await expect(series.getByRole("checkbox").first()).toBeVisible();
  expect(
    await series.evaluate(
      (element) => element.scrollHeight >= element.clientHeight,
    ),
  ).toBe(true);
  await page
    .getByLabel("Выбрать изображения", { exact: true })
    .setInputFiles(image);
  await expect(page.locator(".ProseMirror img")).toBeVisible();
  await page
    .getByRole("slider", { name: "Размер изображения", exact: true })
    .fill("50");
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "Размер изображения", exact: true }),
  ).toHaveValue("50");
  const width = await page
    .locator(".ProseMirror img")
    .evaluate(
      (element) =>
        element.getBoundingClientRect().width /
        (element.closest(".ProseMirror")?.getBoundingClientRect().width ?? 0),
    );
  expect(width).toBeCloseTo(0.5, 1);
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  await expect(page.locator('figure[style*="50%"]')).toBeVisible();
});

test("block insertion follows its paragraph across a pending upload; cancelling a link leaves no paragraph", async ({
  page,
}) => {
  await createDraft(page, "фоновая вставка");
  const body = page.locator(".ProseMirror");
  await body.fill("Первый абзац");
  await body.press("Enter");
  await page.keyboard.type("Последний абзац");
  await saved(page);
  const plus = page.getByRole("button", { name: "Добавить блок", exact: true });
  const first = body.locator(":scope > p").first();
  await first.hover();
  await expect
    .poll(async () =>
      Math.abs(
        ((await plus.boundingBox())?.y ?? Number.NaN) -
          ((await first.boundingBox())?.y ?? Number.NaN),
      ),
    )
    .toBeLessThan(2);
  const before = await body.innerHTML();
  await plus.click();
  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(await body.innerHTML()).toBe(before);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/authoring/materials/*/assets", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await first.hover();
  await expect
    .poll(async () =>
      Math.abs(
        ((await plus.boundingBox())?.y ?? Number.NaN) -
          ((await first.boundingBox())?.y ?? Number.NaN),
      ),
    )
    .toBeLessThan(2);
  await plus.click();
  const upload = page.waitForRequest("**/api/authoring/materials/*/assets");
  await page
    .getByLabel("Выбрать изображения", { exact: true })
    .setInputFiles(image);
  await upload;
  const last = body.getByText("Последний абзац", { exact: true });
  await last.hover();
  await expect
    .poll(async () =>
      Math.abs(
        ((await plus.boundingBox())?.y ?? Number.NaN) -
          ((await last.boundingBox())?.y ?? Number.NaN),
      ),
    )
    .toBeLessThan(2);
  await plus.click();
  release?.();
  await expect(body.locator("img")).toBeVisible();
  await page.getByRole("button", { name: "Заголовок H2", exact: true }).click();
  await page.keyboard.type("После выбранного абзаца");
  expect(
    await body
      .locator("h2")
      .evaluate((element) => element.previousElementSibling?.textContent),
  ).toBe("Последний абзац");
  await saved(page);
  await page.reload();
  expect(
    await body
      .locator("h2")
      .evaluate((element) => element.previousElementSibling?.textContent),
  ).toBe("Последний абзац");
});

test("metadata stays above the article; adjacent blocks have space and Shift+Enter exits nested blocks", async ({
  page,
}) => {
  await createDraft(page, "переходы между блоками");
  const metadata = page.getByRole("region", {
    name: "Параметры материала",
    exact: true,
  });
  const article = page.getByRole("region", {
    name: "Содержимое материала",
    exact: true,
  });
  const metadataBox = await metadata.boundingBox();
  const articleBox = await article.boundingBox();
  if (!articleBox || !metadataBox)
    throw new Error("Authoring sections must be visible");
  expect(articleBox.y).toBeGreaterThanOrEqual(
    metadataBox.y + metadataBox.height,
  );
  const body = page.locator(".ProseMirror");
  await body.fill("Перед блоками");
  const plus = page.getByRole("button", { name: "Добавить блок", exact: true });
  await plus.click();
  await page.getByRole("button", { name: "Код", exact: true }).click();
  await page.keyboard.type("const answer = 42;");
  await plus.click();
  await page.getByRole("button", { name: "Таблица", exact: true }).click();
  const codeBox = await body.locator("pre").boundingBox();
  const tableBox = await body.locator("table").boundingBox();
  if (!tableBox || !codeBox) throw new Error("Both blocks must be visible");
  expect(tableBox.y - codeBox.y - codeBox.height).toBeGreaterThanOrEqual(20);
  await body.locator("th").first().click();
  await page.keyboard.type(`Ячейка ${"long_identifier_".repeat(15)}`);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("После таблицы");
  await expect(
    body.locator(":scope > p").filter({ hasText: "После таблицы" }),
  ).toHaveCount(1);
  await expect(body.locator("table")).not.toContainText("После таблицы");
  await body.locator("pre code").click();
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("После кода");
  await expect(body.locator("pre + p")).toHaveText("После кода");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Через пустой абзац");
  await saved(page);
  await page.reload();
  await expect(body.locator("pre + p + p")).toHaveText("");
  await expect(body.locator("pre + p + p + p")).toHaveText(
    "Через пустой абзац",
  );
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  const cell = page.locator("table th").first();
  expect(
    await cell.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
});

test("responsive image preview loads real pixels, reports a failed delivery and retries without losing caption", async ({
  page,
  context,
}) => {
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 1400, height: 900 });
  await fixture.setContent(
    '<main style="background:#124c80;color:white;height:900px;font:48px sans-serif">Изображение для проверки предпросмотра</main>',
  );
  const buffer = await fixture.screenshot();
  await fixture.close();
  await createDraft(page, "предпросмотр изображения");
  await page
    .getByLabel("Выбрать изображения", { exact: true })
    .setInputFiles({ name: "large-image.png", mimeType: "image/png", buffer });
  await expect(page.locator(".ProseMirror img")).toBeVisible();
  await page
    .getByLabel("Подпись изображения", { exact: true })
    .fill("Подпись под изображением");
  await page.getByText("Описание", { exact: true }).click();
  await page
    .getByLabel("Описание изображения", { exact: true })
    .fill("Синий фон с белым текстом");
  await page.setViewportSize({ width: 320, height: 800 });
  const description = page.getByLabel("Описание изображения", { exact: true });
  await description.scrollIntoViewIfNeeded();
  const panel = await description.boundingBox();
  if (!panel) throw new Error("Image description must be visible");
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await saved(page);
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  const picture = page.locator("figure img");
  await expect
    .poll(() =>
      picture.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(1);
  const shape = await picture.evaluate((element) => {
    const img = element as HTMLImageElement;
    const box = img.getBoundingClientRect();
    return {
      displayed: box.width / box.height,
    };
  });
  expect(shape.displayed).toBeCloseTo(1400 / 900, 1);
  await page.route("**/api/materials/*/assets/*/images/*", (route) =>
    route.abort(),
  );
  await page.reload();
  await expect(
    page.getByText("Не удалось загрузить изображение.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("figcaption")).toHaveText(
    "Подпись под изображением",
  );
  await page.unroute("**/api/materials/*/assets/*/images/*");
  await page
    .getByRole("button", { name: "Загрузить снова", exact: true })
    .click();
  await expect
    .poll(() =>
      picture.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(1);
  await expect(picture).toHaveAttribute("alt", "Синий фон с белым текстом");
});

test("image block selection keeps controls readable while resizing and opening the description", async ({
  page,
}) => {
  await createDraft(page, "выделение изображения");
  await page
    .getByLabel("Выбрать изображения", { exact: true })
    .setInputFiles(image);
  const picture = page.locator(".ProseMirror img");
  await expect(picture).toBeVisible();
  await saved(page);
  for (const fullscreen of [false, true]) {
    if (fullscreen)
      await page
        .getByRole("button", { name: "На весь экран", exact: true })
        .click();
    for (const size of [85, 50]) {
      await page
        .getByLabel("Размер изображения", { exact: true })
        .fill(String(size));
      await saved(page);
      await page.getByText("Описание", { exact: true }).click();
      await picture.click();
      await expect(page.locator(".ProseMirror")).toHaveClass(
        /ProseMirror-hideselection/u,
      );
      const colors = await page
        .locator(
          ".ProseMirror label, .ProseMirror summary, .ProseMirror output",
        )
        .evaluateAll((elements) =>
          elements.map((element) => ({
            text: getComputedStyle(element).color,
            selected: getComputedStyle(element, "::selection").color,
          })),
        );
      expect(colors.length).toBeGreaterThan(2);
      for (const color of colors) expect(color.selected).toBe(color.text);
    }
  }
});
