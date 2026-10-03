// @ts-check
/**
 * Порты браузерных проверок `pnpm check` (#896). Переменная окружения задаёт порт явно; без неё
 * порт берётся свободным из диапазона `reservePort` в `scripts/smoke-stand.mjs`. Фиксированный порт
 * по умолчанию занимала проверка соседнего worktree, и прогон падал до первого теста.
 *
 * Playwright загружает конфигурацию в главном процессе и заново в каждом worker. Выбранный порт
 * записывается в `process.env`: worker наследует окружение главного процесса и получает тот же
 * порт, а не новый.
 *
 * Конфигурация Playwright синхронна, а проверка свободного порта — нет, поэтому порты выбирает
 * дочерний процесс. Playwright транспилирует этот модуль в CommonJS, где `import.meta` нет, поэтому
 * `scripts/smoke-stand.mjs` ищется от корня рабочего пространства, как в `scripts/evidence-path.mjs`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Выбирает `argv[2]` портов одним процессом: `reservePort` не выдаёт порт дважды. */
const reservePorts = `
const { reservePort } = await import(process.argv[1]);
const ports = [];
for (let index = 0; index < Number(process.argv[2]); index += 1) {
  ports.push(await reservePort());
}
process.stdout.write(ports.join(" "));
`;

function smokeStandModule() {
  let directory = process.cwd();
  while (!existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`No pnpm-workspace.yaml above ${process.cwd()}`);
    }
    directory = parent;
  }
  return pathToFileURL(path.join(directory, "scripts/smoke-stand.mjs")).href;
}

/**
 * Порт каждой переменной в порядке `names`: заданный явно или свободный из резервного диапазона.
 *
 * @param {readonly string[]} names
 * @returns {string[]}
 */
export function browserTestPorts(names) {
  const missing = names.filter((name) => (process.env[name] ?? "") === "");
  if (missing.length > 0) {
    const reserved = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        reservePorts,
        smokeStandModule(),
        String(missing.length),
      ],
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
