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

/**
 * Снимок живого маршрута #1718 для production visual gate. Без `CAPTURE_SALES_ADMIN_EVIDENCE=1`
 * ничего не делает, и сценарий идёт как обычно. С ним до снимка проверяет, что у страницы нет
 * горизонтальной прокрутки и Axe чист для всей страницы вместе с каркасом, а итог проверки дописывает
 * в `live-checks-<проект>.json`. Набор навигации идёт в один поток, поэтому файл пишется без гонок.
 * Каталог выбирает `UPDATE_EVIDENCE=issue-1718` (`scripts/evidence-path.mjs`).
 */
export async function salesAdminEvidence(
  page: Page,
  info: TestInfo,
  state: string,
): Promise<void> {
  if (process.env["CAPTURE_SALES_ADMIN_EVIDENCE"] !== "1") return;
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

  const directory = await prepareEvidenceDirectory("issue-1718");
  const file = `live-${state}-${info.project.name}.png`;
  const path = resolve(directory, file);
  // Снимок всей страницы рисует закреплённые элементы там, где стоит прокрутка: шаг сценария,
  // прокрутивший телефон к кнопке, оставил бы верхнюю строку и скрытую ссылку «Перейти к
  // содержанию» посреди снимка.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  // На телефоне прокручивается сам документ, и `fullPage` оставил бы нижнюю панель на границе
  // первого экрана поверх содержимого. Окно на время снимка растягивается на всю высоту документа.
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
  await info.attach(`sales-admin-${state}`, { path, contentType: "image/png" });

  const url = new URL(page.url());
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
    scrollWidth,
    clientWidth,
    axeViolations: scan.violations.length,
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
