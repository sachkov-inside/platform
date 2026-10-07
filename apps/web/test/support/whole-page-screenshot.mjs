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
 * Перед каждым замером помощник ждёт конца CSS-переходов (#1035). Кнопки с `transition-all` после
 * `html { font-size: 200% }` растут в rem ещё 150ms, и замер посреди перехода мерит промежуточную
 * высоту: следующий шаг снова находит скрытую часть, а после потолка шагов помощник падает. Ждёт он
 * только переходы: идущий переход конечен, а бесконечная или привязанная к прокрутке анимация не
 * закончилась бы никогда.
 *
 * Chromium 153 из Playwright 1.63.0 изредка отказывает в снимке с «Unable to capture screenshot»
 * (#1029). Этот ответ
 * `PageHandler::ScreenshotCaptured` (`content/browser/devtools/protocol/page_handler.cc`) даёт на
 * пустой кадр. Кадр пуст, когда `RenderWidgetHostImpl::OnSnapshotFromSurfaceReceived`
 * (`render_widget_host_impl.cc`) не получил копию поверхности за `kMaxRetries = 5` немедленных
 * повторов. Помощник делает до `captureAttempts` снимков всего, а другие ошибки не повторяет.
 * Каждый повтор пишет предупреждение в лог: отказ остаётся
 * виден, даже когда следующий снимок удался.
 *
 * После отказа (#1039) следующий снимок ждёт `Page.screencastFrame`: Chromium уже скопировал
 * непустой кадр. Немедленные повторы из #1029 могли все обращаться к ещё недоступной поверхности.
 * Служебный screencast закрывается до следующего снимка; его кадр не заменяет полное изображение.
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

/** Сколько снимков всего помощник делает, пока Chromium отказывает скопировать кадр. */
const captureAttempts = 3;

/** Бюджет ожидания скопированного кадра Chromium после отказа, в миллисекундах. */
const frameCopyBudget = 10_000;

/** Бюджет одной команды закрытия CDP после ожидания кадра, в миллисекундах. */
const cdpCleanupBudget = 1_000;

/**
 * Сколько миллисекунд помощник ждёт конца CSS-переходов перед одним замером. Переход кнопки длится
 * 150ms; бюджет только останавливает застрявший прогон: переход на паузе или переход длиной в часы.
 */
const transitionsBudget = 10_000;

/**
 * Без заданного окна (`viewport: null`) размер не меняется, и снимок — обычный `fullPage`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {Omit<import("@playwright/test").PageScreenshotOptions, "fullPage">} [options]
 * @returns {Promise<Buffer>}
 */
export async function screenshotWholePage(page, options = {}) {
  const viewport = page.viewportSize();
  if (viewport === null) return screenshotRetryingFrameCopy(page, options);
  let height = viewport.height;
  try {
    for (let step = 0; ; step += 1) {
      const hidden = await page.evaluate(settledHiddenScrollHeight, {
        selectors: scrollContainers,
        budget: transitionsBudget,
      });
      if (hidden === 0) {
        return await screenshotRetryingFrameCopy(page, options);
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
async function screenshotRetryingFrameCopy(page, options) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await page.screenshot({ ...options, fullPage: true });
    } catch (error) {
      if (attempt === captureAttempts || !isFrameCopyRefusal(error))
        throw error;
      console.warn(
        `screenshotWholePage: Chromium could not copy the frame (attempt ${String(attempt)} of ${String(captureAttempts)}); waiting for a readable compositor frame before taking the capture again (#1039)`,
      );
      await waitForFrameCopy(page);
    }
  }
}

/**
 * CDP screencast отдаёт событие только после копирования и кодирования кадра. Запрашиваем уменьшенный
 * служебный кадр: нужен факт доступности поверхности, а не ещё один снимок всей страницы. Предел 1×1
 * Chromium может округлить до нулевой стороны и оставить размер по умолчанию (#1039).
 * Таймер только останавливает застрявшее ожидание; завершает его событие Chromium, а не длительность.
 *
 * @param {import("@playwright/test").Page} page
 */
async function waitForFrameCopy(page) {
  const opening = page.context().newCDPSession(page);
  let session;
  try {
    session = await withinBudget(
      opening,
      frameCopyBudget,
      "Chromium did not open the temporary CDP session",
    );
  } catch (error) {
    // CDP-команду нельзя отменить: если ответ придёт после бюджета, закрываем позднюю сессию.
    void opening
      .then(
        (lateSession) => lateSession.detach(),
        () => undefined,
      )
      .catch((cleanupError) =>
        console.warn(
          "screenshotWholePage: late CDP session cleanup failed",
          cleanupError,
        ),
      );
    throw error;
  }
  try {
    const copied = new Promise((resolve) => {
      session.once("Page.screencastFrame", resolve);
    });
    await withinBudget(
      Promise.all([
        copied,
        session.send("Page.startScreencast", {
          format: "png",
          maxWidth: 64,
          maxHeight: 64,
        }),
      ]),
      frameCopyBudget,
      "Chromium did not copy a compositor frame",
    );
  } finally {
    try {
      await withinBudget(
        session.send("Page.stopScreencast"),
        cdpCleanupBudget,
        "Chromium did not stop the temporary screencast",
      );
    } finally {
      await withinBudget(
        session.detach(),
        cdpCleanupBudget,
        "Chromium did not detach the temporary CDP session",
      );
    }
  }
}

/**
 * CDPSession.send и detach в Playwright идут без timeout. Бюджет не отменяет команду протокола,
 * но перестаёт её ждать; finally всё равно отправляет следующую команду закрытия.
 *
 * @template Result
 * @param {Promise<Result>} operation
 * @param {number} budget
 * @param {string} failure
 */
async function withinBudget(operation, budget, failure) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      operation,
      /** @type {Promise<never>} */ (
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${failure} within ${String(budget)}ms`)),
            budget,
          );
        })
      ),
    ]);
  } finally {
    clearTimeout(timer);
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
 * Выполняется в браузере: сколько пикселей прячет прокрутка контейнеров, когда CSS-переходы
 * закончились. Контейнер без собственной прокрутки не считается: ниже брейкпоинта его содержимое
 * уже входит в высоту документа. Отменённый переход отклоняет `finished`; его итог помощнику не
 * нужен, поэтому `allSettled`. Конец одного перехода может запустить другой, поэтому список
 * переходов проверяется заново, пока он не опустеет или не кончится бюджет.
 *
 * Типы DOM описаны здесь, а не через `lib: dom`: ссылка на библиотеку действовала бы на все скрипты
 * `tsconfig.scripts.json` сразу.
 *
 * @param {{ readonly selectors: readonly string[], readonly budget: number }} settle
 */
async function settledHiddenScrollHeight({ selectors, budget }) {
  /**
   * @typedef {{ readonly scrollHeight: number, readonly clientHeight: number }} ScrollBox
   * @typedef {{ readonly finished: Promise<unknown> }} DocumentAnimation
   * @typedef {{
   *   document: {
   *     querySelector(selector: string): ScrollBox | null,
   *     getAnimations(): readonly DocumentAnimation[],
   *   },
   *   getComputedStyle(element: ScrollBox): { readonly overflowY: string },
   *   CSSTransition: abstract new () => DocumentAnimation,
   *   performance: { now(): number },
   *   setTimeout(callback: () => void, delay: number): unknown,
   * }} BrowserGlobals
   */
  /* oxlint-disable typescript/no-unsafe-type-assertion -- runs in the page, where globalThis is the window */
  const browser = /** @type {BrowserGlobals} */ (
    /** @type {unknown} */ (globalThis)
  );
  /* oxlint-enable typescript/no-unsafe-type-assertion */
  const { document, getComputedStyle, CSSTransition, performance, setTimeout } =
    browser;
  const transitionsOverBudget = () =>
    new Error(
      `CSS transitions still run after ${String(budget)}ms: a transition is paused or too long for a capture`,
    );
  const deadline = performance.now() + budget;
  for (;;) {
    if (performance.now() >= deadline) throw transitionsOverBudget();
    const transitions = document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition);
    if (transitions.length === 0) break;
    const settled = await Promise.race([
      Promise.allSettled(transitions.map(({ finished }) => finished)).then(
        () => true,
      ),
      /** @type {Promise<boolean>} */ (
        new Promise((resolve) => {
          setTimeout(() => resolve(false), deadline - performance.now());
        })
      ),
    ]);
    if (!settled) throw transitionsOverBudget();
  }
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
