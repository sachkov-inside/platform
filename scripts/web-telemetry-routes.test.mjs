// @ts-check
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

test("telemetry templates match the current web page tree", async () => {
  const root = new URL("../apps/web/app/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  const expected = files
    .filter((file) => file.endsWith("page.tsx"))
    .map(
      (file) =>
        "/" +
        path
          .dirname(file)
          .split(path.sep)
          .filter((part) => part !== "." && !part.startsWith("("))
          .join("/"),
    );
  const source = await readFile(
    new URL(
      "../apps/backend/src/modules/web-telemetry/domain/route-templates.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const array = source.match(
    /telemetryRouteTemplates\s*=\s*\[([\s\S]*?)\]/u,
  )?.[1];
  // Brackets in route strings are part of the templates, not the end of the array.
  const strings =
    source
      .slice(source.indexOf("["), source.indexOf("as const"))
      .match(/"[^"\n]+"/gu) ?? [];
  assert.ok(array !== undefined);
  assert.deepEqual(
    strings.map((item) => item.slice(1, -1)).sort(),
    expected.sort(),
  );
});
