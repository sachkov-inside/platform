/** Capture only after separately logged successful builds at the explicit source commit. */
import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactAlgorithm,
  hashArtifact,
  sourceIdentity,
} from "./artifacts.mjs";

const [contextArgument, outputArgument, variant, builtSource] =
  process.argv.slice(2);
assert(contextArgument && outputArgument && builtSource);
assert(variant === "legacy" || variant === "current");
const context = resolve(contextArgument);
const source = await sourceIdentity(context);
assert.equal(source[0], builtSource, "Build source changed before capture");
const output = resolve(outputArgument, variant);
// Refuse to overwrite any earlier captured evidence.
await mkdir(output);
const artifacts = {};
for (const app of ["backend", "telegram", "web"]) {
  const prefix = app === "web" ? "standalone" : "dist";
  const base = resolve(
    context,
    "apps",
    app,
    app === "web" ? ".next/standalone" : "dist",
  );
  artifacts[app] = await hashArtifact(base, prefix);
  await cp(base, resolve(output, app, prefix), {
    recursive: true,
    dereference: false,
  });
  assert.deepEqual(
    await hashArtifact(resolve(output, app, prefix), prefix),
    artifacts[app],
  );
}
assert.deepEqual(await sourceIdentity(context), source);
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(
    {
      algorithm: artifactAlgorithm,
      source,
      nodeVersion: process.version,
      artifacts,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ source, artifacts, output }));
