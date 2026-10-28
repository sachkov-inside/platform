import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { isAbsolute } from "node:path";

const marker = process.env["INSIDE_TEST_WORKER_READINESS_PATH"];
assert.ok(typeof marker === "string" && isAbsolute(marker));
const runtime = new URL(
  "../../../dist/infrastructure/worker-runtime.js",
  import.meta.url,
).href;

// Only this child uses an owned marker. The CLI, schema verifier and PostgreSQL remain real.
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== runtime) return loaded;
    const source = Buffer.from(loaded.source).toString("utf8");
    const declaration =
      'export const WORKER_READINESS_PATH = "/tmp/inside-platform-worker-ready.json";';
    assert.equal(source.split(declaration).length, 2);
    return {
      ...loaded,
      source: source.replace(
        declaration,
        `export const WORKER_READINESS_PATH = ${JSON.stringify(marker)};`,
      ),
    };
  },
});
