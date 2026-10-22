// @ts-check
import { readFileSync } from "node:fs";

/**
 * Dependency-free reader for the `name` and `scripts` of a package.json. Documentation and
 * pre-commit checks use it so they run before `pnpm install`; other scripts use the schema in
 * package-manifest.mjs.
 *
 * @param {string} path
 * @returns {{ name: string; scripts: Record<string, string> }}
 */
export function readPackageScripts(path) {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`${path}: package.json must be an object`);
  }
  const name = "name" in manifest ? manifest.name : "";
  const scripts = "scripts" in manifest ? manifest.scripts : {};
  if (typeof name !== "string") {
    throw new Error(`${path}: package name must be a string`);
  }
  if (typeof scripts !== "object" || scripts === null) {
    throw new Error(`${path}: scripts must be an object`);
  }
  /** @type {Record<string, string>} */
  const result = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== "string") {
      throw new Error(`${path}: script ${key} must be a string`);
    }
    result[key] = value;
  }
  return { name, scripts: result };
}
