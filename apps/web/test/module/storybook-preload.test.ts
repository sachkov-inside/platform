import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { expect, it } from "vitest";

const web = createRequire(import.meta.url);

/** Каталог пакета, который видит модуль `from`. */
function packageDirectory(from: NodeJS.Require, name: string): string {
  return path.dirname(realpathSync(from.resolve(`${name}/package.json`)));
}

function requireFrom(from: NodeJS.Require, name: string): NodeJS.Require {
  return createRequire(path.join(packageDirectory(from, name), "package.json"));
}

// Предзагрузка `test/support/storybook-preload.ts` помогает, только если она подключена к проекту
// `storybook` и web получает те же пакеты, что Storybook: иначе Vite соберёт вторую копию, а
// ленивая загрузка останется внутри первой истории файла (#1095).
it("wires the preload into the storybook project", () => {
  const config = readFileSync(
    new URL("../../vitest.config.mts", import.meta.url),
    "utf8",
  );

  expect(config).toContain(
    'setupFiles: ["./test/support/storybook-preload.ts"]',
  );
});

it("resolves the axe-core copy that addon-a11y imports", () => {
  const addonA11y = requireFrom(web, "@storybook/addon-a11y");

  expect(packageDirectory(web, "axe-core")).toBe(
    packageDirectory(addonA11y, "axe-core"),
  );
});

it("resolves the react-dom shim copy that the Storybook React renderer imports", () => {
  const renderer = requireFrom(
    requireFrom(web, "@storybook/react-vite"),
    "@storybook/react",
  );

  expect(packageDirectory(web, "@storybook/react-dom-shim")).toBe(
    packageDirectory(renderer, "@storybook/react-dom-shim"),
  );
});
