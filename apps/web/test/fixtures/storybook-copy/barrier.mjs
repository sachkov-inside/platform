// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated process: fs.cp captures fs.promises.stat on its first call. Hold the
// missing images observation so Vite's real public copy runs before cp's mkdir.
const root = process.argv[3];
const output = join(root, "output");
const images = join(output, "images");
const originalStat = fs.stat;
let observedMissing;
const missing = new Promise((resolveMissing) => {
  observedMissing = resolveMissing;
});
let resumeStat;
const resumed = new Promise((resolveResume) => {
  resumeStat = resolveResume;
});
fs.stat = async (path, ...args) => {
  try {
    return await originalStat(path, ...args);
  } catch (error) {
    if (path === images && error.code === "ENOENT") {
      observedMissing();
      await resumed;
    }
    throw error;
  }
};

try {
  const { default: config } = await import("../../../.storybook/main.ts");
  const { build } = await import("vite");
  const configDir = fileURLToPath(
    new URL("../../../.storybook/", import.meta.url),
  );
  const webRoot = dirname(configDir);
  await fs.mkdir(output);
  await fs.writeFile(join(root, "entry.js"), "export const value = 1;\n");
  const sources = config.staticDirs.map((dir) => {
    const from = typeof dir === "string" ? dir : dir.from;
    const to = typeof dir === "string" ? "/" : dir.to;
    return { from: resolve(configDir, from), to: join(output, to) };
  });
  // Storybook 10.6.1 core-server copyAllStaticFilesRelativeToMain awaits each
  // staticDir in order, including the two shared task-asset destinations.
  const copying = sources.reduce(async (previous, source) => {
    await previous;
    await fs.cp(source.from, source.to, {
      dereference: true,
      preserveTimestamps: true,
      filter: (_, dest) =>
        ![join(output, "index.html"), join(output, "iframe.html")].includes(
          dest,
        ),
      recursive: true,
      force: true,
    });
  }, Promise.resolve());
  const outcome = copying.then(
    () => null,
    (error) => error,
  );
  await missing;
  const finalConfig = await config.viteFinal({});
  await build({
    ...finalConfig,
    configFile: false,
    root: webRoot,
    publicDir: join(webRoot, "public"),
    logLevel: "silent",
    build: {
      ...finalConfig.build,
      ...(process.argv[2] === "reproduce" ? { copyPublicDir: true } : {}),
      emptyOutDir: false,
      outDir: output,
      lib: {
        entry: join(root, "entry.js"),
        formats: ["es"],
        fileName: "entry",
      },
    },
  });
  resumeStat();
  const error = await outcome;
  if (process.argv[2] === "reproduce") {
    assert.equal(error?.code, "EEXIST");
    assert.equal(error?.path, images);
    assert.equal(error?.syscall, "mkdir");
  } else {
    assert.equal(error, null);
    // Verify every file behind every existing URL, including both shared task
    // asset sources, public images, material variants and content covers.
    for (const source of sources) {
      for (const entry of await fs.readdir(source.from, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const sourceFile = join(entry.parentPath, entry.name);
        const suffix = sourceFile.slice(source.from.length);
        assert.deepEqual(
          await fs.readFile(join(source.to, suffix)),
          await fs.readFile(sourceFile),
        );
      }
    }
  }
  console.log("filesystem contract passed");
} finally {
  resumeStat();
  fs.stat = originalStat;
}
