// @ts-check
import fs from "node:fs";
import { createRequire } from "node:module";

const core = createRequire("/etc/logto/packages/core/package.json");
/* oxlint-disable typescript/no-unsafe-type-assertion -- installed Logto Zod 3 module boundary */
const { z } = /** @type {typeof import("zod/v3")} */ (core("zod"));
/* oxlint-enable typescript/no-unsafe-type-assertion */
const packageMap = z.record(z.string());
const overlaySchema = z.object({ overrides: packageMap, patchedDependencies: packageMap });
const manifestSchema = z.object({
  pnpm: z.object({ overrides: packageMap.optional(), patchedDependencies: packageMap.optional() }).passthrough().optional(),
}).passthrough();

const manifestPath = new URL("../package.json", import.meta.url);
const overlay = overlaySchema.parse(JSON.parse(
  fs.readFileSync(new URL("manifest-overlay.json", import.meta.url), "utf8"),
));
const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
manifest.pnpm ??= {};
manifest.pnpm.overrides = {
  ...manifest.pnpm.overrides,
  ...overlay.overrides,
};
manifest.pnpm.patchedDependencies = {
  ...manifest.pnpm.patchedDependencies,
  ...overlay.patchedDependencies,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
