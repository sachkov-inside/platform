import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const rootPackage = JSON.parse(read("package.json"));
const backendPackage = JSON.parse(read("apps/backend/package.json"));
const webPackage = JSON.parse(read("apps/web/package.json"));
const nodeVersion = read(".node-version").trim();
const pnpmVersion = rootPackage.packageManager.replace(/^pnpm@/u, "");

describe("supported toolchain contract", () => {
  it("keeps Docker on the repository Node and pnpm pins", () => {
    const dockerfile = read("Dockerfile");

    assert.match(
      dockerfile,
      new RegExp(`^FROM node:${escapeRegExp(nodeVersion)}-alpine\\d+\\.\\d+@sha256:[a-f0-9]{64} AS toolchain$`, "mu"),
    );
    assert.match(
      dockerfile,
      new RegExp(`corepack install --global pnpm@${escapeRegExp(pnpmVersion)}(?:\\s|$)`, "u"),
    );
  });

  it("keeps TypeScript exact and Node declarations on the runtime major", () => {
    const nodeMajor = nodeVersion.split(".")[0];
    const packages = [rootPackage, backendPackage, webPackage];
    const typeScriptPins = packages.map((manifest) => manifest.devDependencies.typescript);

    assert.equal(new Set(typeScriptPins).size, 1);
    assert.ok(typeScriptPins.every((version) => /^\d+\.\d+\.\d+$/u.test(version)));
    for (const manifest of [backendPackage, webPackage]) {
      assert.equal(manifest.devDependencies["@types/node"].split(".")[0], nodeMajor);
    }
  });

  it("pins every container image by digest and every GitHub Action by commit", () => {
    for (const path of ["compose.yaml", ".github/workflows/application-ci.yml"]) {
      const imageLines = read(path)
        .split("\n")
        .filter((line) => /^\s*image:/u.test(line));
      assert.ok(imageLines.length > 0, `${path} must declare at least one image`);
      assert.ok(
        imageLines.every((line) => /:\d[^\s]*@sha256:[a-f0-9]{64}$/u.test(line.trim())),
        `${path} contains an unpinned image`,
      );
    }

    const actionLines = read(".github/workflows/application-ci.yml")
      .split("\n")
      .filter((line) => /^\s*uses:/u.test(line));
    assert.ok(actionLines.length > 0);
    assert.ok(
      actionLines.every((line) => /@[a-f0-9]{40}(?:\s+#\s+v\d+\.\d+\.\d+)?$/u.test(line.trim())),
    );
  });

  it("groups only patch/minor Dependabot updates", () => {
    const dependabot = read(".github/dependabot.yml");
    const groupBodies = [...dependabot.matchAll(/^\s{6}(\S+):\n((?:\s{8,}.*\n?)*)/gmu)];

    assert.ok(groupBodies.length > 0);
    for (const [, name, body] of groupBodies) {
      assert.match(body, /^\s{8}update-types: \[minor, patch\]$/mu, `${name} can mix major updates`);
    }
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
