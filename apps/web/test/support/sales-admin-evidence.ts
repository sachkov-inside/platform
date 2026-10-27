import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { z } from "zod";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "./whole-page-screenshot.mjs";

const liveChecksSchema = z.array(
  z.object({
    file: z.string(),
    project: z.string(),
    url: z.string(),
    scrollWidth: z.number(),
    clientWidth: z.number(),
    axeViolations: z.number(),
  }),
);
type LiveCheck = z.infer<typeof liveChecksSchema>[number];

/** Откуда снимок: флаг, который его включает, и каталог задачи в `docs/evidence`. */
export interface AdminEvidenceTarget {
  readonly flag: string;
  readonly issue: `issue-${number}`;
}

/**
 * Снимок живого маршрута #1718 для production visual gate. Без `CAPTURE_SALES_ADMIN_EVIDENCE=1`
 * ничего не делает, и сценарий идёт как обычно. Каталог выбирает `UPDATE_EVIDENCE=issue-1718`
 * (`scripts/evidence-path.mjs`).
 */
export function salesAdminEvidence(
  page: Page,
  info: TestInfo,
  state: string,
): Promise<void> {
  return adminEvidence(page, info, state, {
    flag: "CAPTURE_SALES_ADMIN_EVIDENCE",
    issue: "issue-1718",
  });
}

/**
 * Снимок живого маршрута админки для production visual gate задачи `target.issue`. Без флага
 * `target.flag=1` ничего не делает. С ним до снимка проверяет, что у страницы нет горизонтальной
 * прокрутки и Axe чист для всей страницы вместе с каркасом, а итог проверки дописывает в
 * `live-checks-<проект>.json`. Набор навигации идёт в один поток, поэтому файл пишется без гонок.
 */
export async function adminEvidence(
  page: Page,
  info: TestInfo,
  state: string,
  target: AdminEvidenceTarget,
  { viewportAtBottom = false }: { readonly viewportAtBottom?: boolean } = {},
): Promise<void> {
  if (process.env[target.flag] !== "1") return;
  // Шаг сценария только что закрыл список выбора или снял `disabled`: замер посреди перехода видит
  // полупрозрачную кнопку и закрывающийся список, который ещё прячет остальную страницу. Конечные
  // анимации доигрывают; бесконечные (индикатор загрузки) не ждутся.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((settled) =>
      requestAnimationFrame(() => requestAnimationFrame(settled)),
    );
  });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBe(clientWidth);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  const directory = await prepareEvidenceDirectory(target.issue);
  const file = `live-${state}-${info.project.name}.png`;
  const path = resolve(directory, file);
  if (viewportAtBottom) {
    // Только окно, без растяжения: страница прокручена до конца, как её видит человек. Так видно,
    // стоит ли нижняя панель вплотную к краю окна.
    await page.evaluate(() => {
      document.querySelector("#authoring-content")?.scrollTo(0, 1e9);
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.screenshot({ path });
  } else await captureWholePage(page, path);
  await info.attach(`${target.issue}-${state}`, {
    path,
    contentType: "image/png",
  });
  await recordCheck(info, directory, file, page.url(), {
    scrollWidth,
    clientWidth,
    axeViolations: scan.violations.length,
  });
}

/**
 * Снимок всей страницы рисует закреплённые элементы там, где стоит прокрутка: шаг сценария,
 * прокрутивший телефон к кнопке, оставил бы верхнюю строку и скрытую ссылку «Перейти к содержанию»
 * посреди снимка. На телефоне прокручивается сам документ, и `fullPage` оставил бы нижнюю панель на
 * границе первого экрана поверх содержимого: окно на время снимка растягивается на всю высоту
 * документа, а под панелью остаётся полоса растянутого окна.
 */
async function captureWholePage(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const viewport = page.viewportSize();
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const stretch = viewport !== null && height > viewport.height;
  if (stretch) await page.setViewportSize({ width: viewport.width, height });
  try {
    await screenshotWholePage(page, { path });
  } finally {
    if (stretch) await page.setViewportSize(viewport);
  }
}

/** Дописывает итог проверок снимка в `live-checks-<проект>.json`. */
async function recordCheck(
  info: TestInfo,
  directory: string,
  file: string,
  pageUrl: string,
  measured: {
    readonly scrollWidth: number;
    readonly clientWidth: number;
    readonly axeViolations: number;
  },
): Promise<void> {
  const url = new URL(pageUrl);
  const checksPath = resolve(
    directory,
    `live-checks-${info.project.name}.json`,
  );
  const checks = await readFile(checksPath, "utf8").then(
    (text) => liveChecksSchema.parse(JSON.parse(text)),
    (): LiveCheck[] => [],
  );
  const check: LiveCheck = {
    file,
    project: info.project.name,
    url: `${url.pathname}${url.search}`,
    ...measured,
  };
  await writeFile(
    checksPath,
    `${JSON.stringify(
      [...checks.filter((entry) => entry.file !== file), check],
      null,
      2,
    )}\n`,
  );
}
