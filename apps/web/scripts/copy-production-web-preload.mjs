// @ts-check
import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** Replay the additional production COPY inputs, after the separately owned standalone and identity.
 * @param {string} directory
 */
export async function copyProductionWebPreload(directory) {
  const dockerfile = await readFile(join(root, "apps/web/Dockerfile"), "utf8");
  const stage = dockerfile.split(" AS web-production\n")[1];
  assert.ok(stage);
  for (const line of stage.split("\n")) {
    if (!line.startsWith("COPY ")) continue;
    const fields = line.split(/\s+/u).slice(1);
    if (
      fields.includes("--from=production-build") ||
      fields.includes("--from=release-identity")
    )
      continue;
    const from = fields.find((field) => field.startsWith("--from="));
    assert.ok(
      from === undefined || from === "--from=dependencies",
      "unsupported production preload source stage",
    );
    const positional = fields.filter((field) => !field.startsWith("--"));
    const target = positional.pop();
    assert.ok(target);
    const destination = resolve(directory, target);
    assert.ok(destination.startsWith(directory + "/"));
    for (const input of positional) {
      const source = join(root, input.replace(/^\/workspace\//u, ""));
      const multiple = positional.length > 1 || target.endsWith("/");
      await mkdir(multiple ? destination : resolve(destination, ".."), {
        recursive: true,
      });
      await cp(
        source,
        multiple ? join(destination, basename(source)) : destination,
        { recursive: true, dereference: true },
      );
    }
  }
}
