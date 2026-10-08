import { realpathSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, it } from "vitest";

const web = createRequire(import.meta.url);

/** Каталог пакета, который видит модуль `from`. */
function packageDirectory(from: NodeJS.Require, name: string): string {
  return realpathSync(from.resolve(`${name}/package.json`)).replace(
    /\/package\.json$/u,
    "",
  );
}

function requireFrom(from: NodeJS.Require, name: string): NodeJS.Require {
  return createRequire(`${packageDirectory(from, name)}/package.json`);
}

// Предзагрузка `test/support/storybook-preload.ts` помогает, только если web и Storybook
// получают один и тот же пакет: иначе Vite соберёт вторую копию, а ленивая загрузка
// останется внутри первой истории файла (#1095).
it("preloads the axe-core copy that addon-a11y imports", () => {
  const addonA11y = requireFrom(web, "@storybook/addon-a11y");

  expect(packageDirectory(web, "axe-core")).toBe(
    packageDirectory(addonA11y, "axe-core"),
  );
});

it("preloads the react-dom shim copy that the Storybook React renderer imports", () => {
  const renderer = requireFrom(
    requireFrom(web, "@storybook/react-vite"),
    "@storybook/react",
  );

  expect(packageDirectory(web, "@storybook/react-dom-shim")).toBe(
    packageDirectory(renderer, "@storybook/react-dom-shim"),
  );
});
