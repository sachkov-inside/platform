// @ts-check
/**
 * Порты Playwright-проверок `pnpm check` (`test:e2e`, `test:navigation`) (#896). Переменная
 * окружения задаёт порт явно; без неё порт берётся свободным из диапазона `reservePort` в
 * `scripts/smoke-stand.mjs`. Фиксированный порт по умолчанию занимала проверка соседнего worktree,
 * и прогон падал до первого теста.
 *
 * Playwright загружает конфигурацию в главном процессе и заново в каждом worker. Выбранный порт
 * записывается в `process.env`: worker наследует окружение главного процесса и получает тот же
 * порт, а не новый.
 *
 * Конфигурация Playwright синхронна, а проверка свободного порта — нет, поэтому порты выбирает
 * дочерний процесс `scripts/reserve-ports.mjs`. Playwright транспилирует этот модуль в CommonJS, где
 * `import.meta` нет, поэтому скрипт ищется от корня рабочего пространства, как в
 * `scripts/evidence-path.mjs`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function reservePortsScript() {
  let directory = process.cwd();
  while (!existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`No pnpm-workspace.yaml above ${process.cwd()}`);
    }
    directory = parent;
  }
  return path.join(directory, "scripts/reserve-ports.mjs");
}

/**
 * Порт каждой переменной в порядке `names`: заданный явно или свободный из резервного диапазона.
 * Тип для TypeScript задаёт `browser-test-ports.d.mts`: кортеж той же длины, что `names`.
 *
 * @param {readonly string[]} names
 * @returns {string[]}
 */
export function browserTestPorts(names) {
  const missing = names.filter((name) => (process.env[name] ?? "") === "");
  if (missing.length > 0) {
    const reserved = execFileSync(
      process.execPath,
      [reservePortsScript(), String(missing.length)],
      { encoding: "utf8" },
    ).split(" ");
    for (const [index, name] of missing.entries()) {
      const port = reserved[index];
      if (port === undefined) throw new Error(`No free port for ${name}`);
      process.env[name] = port;
    }
  }
  return names.map((name) => {
    const port = process.env[name];
    if (port === undefined) throw new Error(`${name} has no port`);
    return port;
  });
}
