/**
 * После production-сборки: ни один Route Handler не должен оказаться предсобранным, кроме
 * статичных по замыслу. Под Cache Components `GET`, который не коснулся запроса до ответа,
 * предсобирается при сборке образа — без конфигурации и backend — и отдаёт застывший ответ
 * (ADR 0026). Guardrail ловит это по форме кода, эта проверка — по факту сборки.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const buildRoot = fileURLToPath(new URL("../.next/", import.meta.url));
// `/social-card` — статичная карточка ссылки площадки, тот же перечень держит guardrail формы кода.
// `/icon.svg` — файл метаданных `app/icon.svg`: Next.js сам заводит ему маршрут, кода у него нет.
const allowed = new Set(["/social-card", "/icon.svg"]);
const readManifest = (name) => JSON.parse(readFileSync(`${buildRoot}${name}`, "utf8"));

const handlerPaths = new Set(
  Object.entries(readManifest("app-path-routes-manifest.json"))
    .filter(([source]) => source.endsWith("/route"))
    .map(([, path]) => path),
);
const prerendered = Object.keys(readManifest("prerender-manifest.json").routes).filter(
  (path) => handlerPaths.has(path) && !allowed.has(path),
);

if (prerendered.length > 0) {
  process.stderr.write(
    `Route Handlers were prerendered at build time and would answer with a frozen response:\n${prerendered.sort().join("\n")}\nStart each GET with await connection().\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("No Route Handler was prerendered at build time.\n");
}
