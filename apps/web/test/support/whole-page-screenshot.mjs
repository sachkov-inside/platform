// @ts-check
/**
 * Снимок страницы целиком (#729). С `lg` оболочка приложения закрепляет высоту и прокручивает
 * `#content`, оболочка авторинга делает то же с `md` и `#authoring-content`. Документ при этом не
 * длиннее окна, и `fullPage` Playwright молча снимает один экран. Помощник растягивает окно по
 * высоте на скрытую часть прокручиваемого контейнера, снимает и возвращает прежний размер. Уже этих
 * брейкпоинтов контейнер не прокручивается, и снимок совпадает с обычным `fullPage`.
 *
 * Страница видит высокое окно: наблюдатели видимости срабатывают для всей её высоты, и ленивая
 * догрузка может показать больше, чем было на экране. После снимка окно прежнее, а прокрутка
 * контейнера остаётся в начале.
 *
 * Chromium изредка отказывает в снимке с «Unable to capture screenshot» (#1029): копия кадра с
 * поверхности не пришла и после его собственных пяти повторов. Отказ зависит от момента в
 * компоновщике, а не от страницы, поэтому помощник снимает заново, не больше `captureAttempts` раз.
 *
 * Модуль на JavaScript, потому что его импортируют и спеки Playwright, и proof-скрипты из
 * `scripts/` и `apps/telegram/test/local`, которые запускает Node без транспиляции. Тип задаёт
 * `whole-page-screenshot.d.mts`.
 */

const scrollContainers = ["#content", "#authoring-content"];

/**
 * Окно растёт, пока контейнер не покажет всё. Обычно хватает одного шага. Если высота содержимого
 * сама следует за высотой окна, шаги не кончатся: после потолка помощник падает, а не снимает
 * обрезанную страницу молча.
 */
const maximumSteps = 3;

/** Сколько раз помощник снимает после отказа Chromium скопировать кадр; другие ошибки не повторяет. */
const captureAttempts = 3;

/**
 * Без заданного окна (`viewport: null`) размер не меняется, и снимок — обычный `fullPage`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {Omit<import("@playwright/test").PageScreenshotOptions, "fullPage">} [options]
 * @returns {Promise<Buffer>}
 */
export async function screenshotWholePage(page, options = {}) {
  const viewport = page.viewportSize();
  if (viewport === null) return capture(page, options);
  let height = viewport.height;
  try {
    for (let step = 0; ; step += 1) {
      const hidden = await page.evaluate(hiddenScrollHeight, scrollContainers);
      if (hidden === 0) {
        return await capture(page, options);
      }
      if (step === maximumSteps) {
        throw new Error(
          `${scrollContainers.join(", ")} still hides ${String(hidden)}px after ${String(maximumSteps)} viewport stretches: the content grows with the viewport`,
        );
      }
      height += hidden;
      await page.setViewportSize({ width: viewport.width, height });
    }
  } finally {
    if (height !== viewport.height) await page.setViewportSize(viewport);
  }
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Omit<import("@playwright/test").PageScreenshotOptions, "fullPage">} options
 * @returns {Promise<Buffer>}
 */
async function capture(page, options) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await page.screenshot({ ...options, fullPage: true });
    } catch (error) {
      if (attempt === captureAttempts || !isFrameCopyRefusal(error))
        throw error;
    }
  }
}

/** @param {unknown} error */
function isFrameCopyRefusal(error) {
  return (
    error instanceof Error &&
    error.message.includes(
      "Page.captureScreenshot): Unable to capture screenshot",
    )
  );
}

/**
 * Выполняется в браузере: сколько пикселей прячет прокрутка контейнеров. Контейнер без собственной
 * прокрутки не считается: ниже брейкпоинта его содержимое уже входит в высоту документа.
 *
 * Типы DOM описаны здесь, а не через `lib: dom`: ссылка на библиотеку действовала бы на все скрипты
 * `tsconfig.scripts.json` сразу.
 *
 * @param {readonly string[]} selectors
 */
function hiddenScrollHeight(selectors) {
  /**
   * @typedef {{ readonly scrollHeight: number, readonly clientHeight: number }} ScrollBox
   * @typedef {{
   *   document: { querySelector(selector: string): ScrollBox | null },
   *   getComputedStyle(element: ScrollBox): { readonly overflowY: string },
   * }} BrowserGlobals
   */
  /* oxlint-disable typescript/no-unsafe-type-assertion -- runs in the page, where globalThis is the window */
  const browser = /** @type {BrowserGlobals} */ (
    /** @type {unknown} */ (globalThis)
  );
  /* oxlint-enable typescript/no-unsafe-type-assertion */
  const { document, getComputedStyle } = browser;
  return Math.max(
    0,
    ...selectors.flatMap((selector) => {
      const container = document.querySelector(selector);
      if (container === null) return [];
      const { overflowY } = getComputedStyle(container);
      return overflowY === "auto" || overflowY === "scroll"
        ? [container.scrollHeight - container.clientHeight]
        : [];
    }),
  );
}
