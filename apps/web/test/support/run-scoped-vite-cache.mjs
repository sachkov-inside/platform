// @ts-check
/**
 * Свой каталог предсобранных зависимостей Vite для каждого процесса Vitest с Storybook (#1004).
 *
 * `storybookTest` кладёт кеш всех запусков одного checkout в один каталог
 * `node_modules/.cache/storybook/<версия>/<проект>/sb-vitest`. Vite пересобирает его на месте, когда
 * у запуска другой хеш конфигурации (Vitest внутри `storybook dev` идёт с `NODE_ENV=development`,
 * CLI — с `test`) или когда посреди прогона находится новая зависимость. Второй запуск при этом
 * заменяет файлы, которые ещё грузит браузер первого: истории первого падают с «Failed to fetch
 * dynamically imported module» и печатают `(0 test)`.
 *
 * Plugin стоит после `storybookTest` (`enforce: "post"`), поэтому его `cacheDir` заменяет общий.
 * Каталог лежит во временной папке системы и удаляется при выходе процесса; после аварийного
 * завершения его убирает очистка временных файлов системы. Общий кеш прогон не ускорял: с пустым
 * каталогом `pnpm test:storybook` идёт столько же, сколько с заполненным.
 *
 * Тип для TypeScript задаёт `run-scoped-vite-cache.d.mts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function runScopedViteCache() {
  /** @type {string | undefined} */
  let cacheDir;
  return {
    name: "inside:run-scoped-vite-cache",
    enforce: /** @type {const} */ ("post"),
    config() {
      if (cacheDir === undefined) {
        const created = mkdtempSync(path.join(tmpdir(), "inside-vitest-deps-"));
        process.once("exit", () => {
          rmSync(created, { recursive: true, force: true });
        });
        cacheDir = created;
      }
      return { cacheDir };
    },
  };
}
