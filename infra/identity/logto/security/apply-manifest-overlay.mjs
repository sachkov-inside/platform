import fs from "node:fs";

const manifestPath = new URL("../package.json", import.meta.url);
const overlay = JSON.parse(
  fs.readFileSync(new URL("manifest-overlay.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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
