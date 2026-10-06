// @ts-check
/// <reference lib="dom" />
/**
 * Снимок страницы целиком (#729). С `lg` оболочка приложения закрепляет высоту и прокручивает
 * `#content`, оболочка авторинга делает то же с `md` и `#authoring-content`. Документ при этом не
 * длиннее окна, и `fullPage` Playwright молча снимает один экран. Помощник растягивает окно по
 * высоте на скрытую часть прокручиваемого контейнера, снимает и возвращает прежний размер. Уже этих
 * брейкпоинтов контейнер не прокручивается, и снимок совпадает с обычным `fullPage`.
 *
 * Модуль на JavaScript, потому что его импортируют и спеки Playwright, и proof-скрипты из
 * `scripts/`, которые запускает Node без транспиляции. Тип задаёт `whole-page-screenshot.d.mts`.
 */

const scrollContainers = ["#content", "#authoring-content"];

/**
 * Окно растёт, пока контейнер не покажет всё. Обычно хватает одного шага; потолок не даёт
 * зациклиться странице, где высота содержимого сама зависит от высоты окна.
 */
const maximumSteps = 3;

/**
 * @param {import("./proof-dependencies.mjs").Page} page
 * @param {Omit<import("./proof-dependencies.mjs").PageScreenshotOptions, "fullPage">} [options]
 * @returns {Promise<Buffer>}
 */
export async function screenshotWholePage(page, options = {}) {
  const viewport = page.viewportSize();
  let height = viewport?.height ?? 0;
  try {
    for (let step = 0; viewport !== null && step < maximumSteps; step += 1) {
      const hidden = await page.evaluate(hiddenScrollHeight, scrollContainers);
      if (hidden === 0) break;
      height += hidden;
      await page.setViewportSize({ width: viewport.width, height });
    }
    return await page.screenshot({ ...options, fullPage: true });
  } finally {
    if (viewport !== null && height !== viewport.height) {
      await page.setViewportSize(viewport);
    }
  }
}

/**
 * Выполняется в браузере: сколько пикселей прячет прокрутка контейнеров. Контейнер без собственной
 * прокрутки не считается: ниже брейкпоинта его содержимое уже входит в высоту документа.
 *
 * @param {readonly string[]} selectors
 */
function hiddenScrollHeight(selectors) {
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
