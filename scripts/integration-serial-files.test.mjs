import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/backend");
const integrationDirectory = "test/integration";

/**
 * Файл integration, который сам поднимает контейнер, форкает процесс или запускает воркер, делит с
 * остальными не только PostgreSQL. Параллельно с набором он меряет загрузку runner, поэтому обязан
 * стоять в последовательном проекте. Список ведётся руками; эта проверка не даёт забыть новый файл.
 */
const serialMarkers = [/\bGenericContainer\b/u, /\bfork\(/u, /\brunWorker\(/u, /\bWORKER_READINESS_PATH\b/u];

export function misplacedIntegrationFiles(files, serialFiles) {
  const listed = new Set(serialFiles);
  return files
    .filter(({ path, source }) => serialMarkers.some((marker) => marker.test(source)) !== listed.has(path))
    .map(({ path }) => path);
}

function listedSerialFiles(config) {
  const block = /const serialFiles = \[([^\]]*)\]/u.exec(config);
  assert.ok(block !== null, "vitest.integration.config.mts must declare serialFiles");
  return [...block[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

describe("integration serial project", () => {
  it("holds exactly the files that own containers, processes or workers", () => {
    const files = readdirSync(resolve(backendRoot, integrationDirectory))
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => {
        const path = `${integrationDirectory}/${name}`;
        return { path, source: readFileSync(resolve(backendRoot, path), "utf8") };
      });
    const serialFiles = listedSerialFiles(
      readFileSync(resolve(backendRoot, "vitest.integration.config.mts"), "utf8"),
    );

    assert.ok(serialFiles.length > 0);
    assert.deepEqual(misplacedIntegrationFiles(files, serialFiles), []);
  });

  it("names a crash test left in the parallel project and a plain file listed as serial", () => {
    const files = [
      { path: "test/integration/crash.test.ts", source: "const child = fork(url);" },
      { path: "test/integration/plain.test.ts", source: "await createMigratedTestDatabase();" },
    ];

    assert.deepEqual(misplacedIntegrationFiles(files, ["test/integration/plain.test.ts"]), [
      "test/integration/crash.test.ts",
      "test/integration/plain.test.ts",
    ]);
  });
});
