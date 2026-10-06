// @ts-check
/**
 * Свой каталог предсобранных зависимостей Vite для каждого процесса Vitest с Storybook (#1004).
 * Почему общий каталог `storybookTest` ломает параллельные прогоны, объясняет раздел
 * «Repository verification» в `docs/runbooks/local-development.md`.
 *
 * Plugin стоит после `storybookTest` (`enforce: "post"`), поэтому его `cacheDir` заменяет общий.
 * Каталог лежит в `$TMPDIR` и удаляется при выходе процесса; Vitest выходит так и по SIGINT и
 * SIGTERM. После SIGKILL или падения по памяти каталог остаётся в `$TMPDIR`.
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
