// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./local-dependency-cache-smoke.py", import.meta.url),
);

/** @param {string} behavior @param {(result: ReturnType<typeof spawnSync>, root: string) => void} verify */
function fixture(behavior, verify) {
  const root = mkdtempSync(join(tmpdir(), "dependency-preflight-contract-"));
  try {
    writeFileSync(
      join(root, "docker"),
      `#!/usr/bin/env python3\nimport os,sys,subprocess,time\nfrom pathlib import Path\nargs=sys.argv[1:]\nwith Path(os.environ['PROOF_CALLS']).open('a') as log: log.write(' '.join(args)+'\\n')\n${behavior}\n`,
      { mode: 0o755 },
    );
    const result = spawnSync("python3", [script, "apps/web/Dockerfile"], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${root}:${process.env["PATH"] ?? ""}`,
        PROOF_CALLS: join(root, "calls"),
        PROOF_PID: join(root, "pid"),
        LOCAL_DEPENDENCY_PREFLIGHT_TIMEOUT_SECONDS: "5",
      },
    });
    verify(result, root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const localContext =
  "if 'context' in args: print('unix:///fixture/docker.sock')";

test("dependency preflight deadline closes a blocked image inspector and its child", () => {
  fixture(
    `${localContext}\nelif 'image' in args:\n child=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)'])\n Path(os.environ['PROOF_PID']).write_text(str(child.pid))\n time.sleep(60)\nelse: print('Driver: docker\\nEndpoint: desktop-linux')`,
    (result, root) => {
      assert.equal(result.status, 124, String(result.stderr));
      const pid = Number(readFileSync(join(root, "pid"), "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    },
  );
});

for (const builder of [
  "docker-container/desktop-linux",
  "docker/foreign-engine",
]) {
  test(`dependency preflight rejects ${builder} before build`, () => {
    const [driver, endpoint] = builder.split("/");
    fixture(
      `${localContext}\nelse: print('Driver: ${driver}\\nEndpoint: ${endpoint}')`,
      (result, root) => {
        assert.equal(result.status, 1, String(result.stderr));
        assert.doesNotMatch(
          readFileSync(join(root, "calls"), "utf8"),
          /(?:image|buildx build)/u,
        );
      },
    );
  });
}

test("dependency preflight preserves missing-base status without invoking build", () => {
  fixture(
    `${localContext}\nelif 'image' in args: sys.exit(7)\nelse: print('Driver: docker\\nEndpoint: desktop-linux')`,
    (result, root) => {
      assert.equal(result.status, 7, String(result.stderr));
      const calls = readFileSync(join(root, "calls"), "utf8");
      assert.match(calls, /--context desktop-linux image inspect .*@sha256:/u);
      assert.doesNotMatch(calls, /buildx build/u);
    },
  );
});
