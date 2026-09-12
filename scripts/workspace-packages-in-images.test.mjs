import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Образ собирается из перечисленных поимённо рабочих пакетов, поэтому новый пакет, забытый в
 * Dockerfile, ломает сборку образа — а обязательный гейт этого не видит: он собирает приложения
 * из рабочего дерева, где пакет есть. Красными становятся только задания Compose, и причина у них
 * выглядит как отказ pnpm пересобрать каталог модулей, а не как забытая строка.
 */
const packages = readdirSync(path.join(repositoryRoot, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const images = ["apps/backend/Dockerfile", "apps/web/Dockerfile"];

test("every workspace package is named in every application image", () => {
  assert.ok(packages.length > 0, "no workspace package found");
  for (const image of images) {
    const dockerfile = readFileSync(path.join(repositoryRoot, image), "utf8");
    for (const name of packages) {
      assert.ok(
        dockerfile.includes(`packages/${name}`),
        `${image} never names packages/${name}: its image cannot install the workspace`,
      );
    }
  }
});
