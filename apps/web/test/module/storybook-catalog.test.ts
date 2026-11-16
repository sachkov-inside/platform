import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parseSync, type ObjectExpression } from "oxc-parser";
import { toId } from "storybook/internal/csf";
import catalog from "../../src/storybook/catalog.json";

const web = fileURLToPath(new URL("../../", import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(`${directory}/${entry.name}`)
      : [`${directory}/${entry.name}`],
  );
}

function metadataOf(path: string): Map<string, string> {
  const source = parseSync(path, readFileSync(path, "utf8"));
  expect(source.errors, path).toEqual([]);
  let metadata: ObjectExpression | undefined;
  for (const statement of source.program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      if (
        declaration.id.type !== "Identifier" ||
        declaration.id.name !== "meta" ||
        !declaration.init
      )
        continue;
      let value = declaration.init;
      while (
        value.type === "TSSatisfiesExpression" ||
        value.type === "TSAsExpression"
      )
        value = value.expression;
      if (value.type === "ObjectExpression") metadata = value;
    }
  }
  if (metadata === undefined) throw new Error(`Missing CSF metadata: ${path}`);
  const values = new Map(
    metadata.properties.flatMap((property) =>
      property.type === "Property" &&
      property.key.type === "Identifier" &&
      property.value.type === "Literal" &&
      typeof property.value.value === "string"
        ? [[property.key.name, property.value.value] as const]
        : [],
    ),
  );
  return values;
}

const storyFiles = files(`${web}src`).filter((path) =>
  path.endsWith(".stories.tsx"),
);

it("keeps stories in the four catalog layers with unique stable identities", () => {
  const ids = new Set<string>();
  for (const path of storyFiles) {
    const values = metadataOf(path);
    expect(values.get("title"), path).toMatch(
      /^(Foundations|Components|Patterns|Pages)\//u,
    );
    const identity = toId(values.get("id") ?? values.get("title") ?? "");
    expect(ids.has(identity), path).toBe(false);
    ids.add(identity);
  }
});

it("gives shared visual modules their own stories and explains helper exceptions", () => {
  const imported = new Set(
    storyFiles.flatMap((path) =>
      parseSync(path, readFileSync(path, "utf8")).program.body.flatMap(
        (node) => {
          if (node.type !== "ImportDeclaration") return [];
          const specifier = node.source.value;
          const base = specifier.startsWith("@/")
            ? resolve(web, "src", specifier.slice(2))
            : specifier.startsWith(".")
              ? resolve(dirname(path), specifier)
              : undefined;
          return base === undefined ? [] : [`${base}.tsx`];
        },
      ),
    ),
  );
  const exceptions = new Map(Object.entries(catalog.sharedModuleExceptions));
  const sharedFiles = files(`${web}src/shared/ui`).filter(
    (path) => path.endsWith(".tsx") && !path.endsWith(".stories.tsx"),
  );
  for (const path of sharedFiles) {
    const relative = path.slice(`${web}src/`.length);
    expect(
      imported.has(path) || (exceptions.get(relative)?.length ?? 0) > 0,
      relative,
    ).toBe(true);
  }
  for (const exception of exceptions.keys()) {
    expect(sharedFiles, exception).toContain(`${web}src/${exception}`);
    expect(
      imported.has(`${web}src/${exception}`),
      `Remove resolved exception: ${exception}`,
    ).toBe(false);
  }
});
