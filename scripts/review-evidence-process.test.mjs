// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { runReviewProcess } from "./review-evidence.test-support.mjs";

const treeSchema = z.object({
  command: z.number(),
  leaf: z.number(),
  owner: z.number(),
});
/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
}

for (const mode of [
  "success",
  "failure",
  "timeout",
  "cleanup-timeout",
  "abort",
  "SIGTERM",
  "SIGKILL",
]) {
  test(
    `review subprocess ${mode} removes its resistant detached descendant before fixture cleanup`,
    { timeout: 30000 },
    async () => {
      const cwd = mkdtempSync(resolve(tmpdir(), "review-process-"));
      const record = resolve(cwd, "tree.json");
      const interruption = new AbortController();
      const ownerInterrupted = mode === "SIGTERM" || mode === "SIGKILL";
      const watcher = watch(cwd);
      let signalled = false;
      // Observe committed descendant readiness before interrupting its owner.
      watcher.on("change", () => {
        if (signalled || !existsSync(record)) return;
        signalled = true;
        if (mode === "abort") interruption.abort();
        if (ownerInterrupted) {
          const tree = treeSchema.parse(
            JSON.parse(readFileSync(record, "utf8")),
          );
          process.kill(tree.owner, mode);
        }
      });
      // deterministic-test-allow duration-wait: rescue a missing timeout in the causal RED contract; runner completion is the barrier.
      const rescue = setTimeout(() => interruption.abort(), 20000);
      try {
        const command = `
        const {spawn} = require('node:child_process');
        const fs = require('node:fs');
        const leaf = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send(process.pid)"], {detached:true, stdio:['ignore','ignore','ignore','ipc']});
        leaf.once('message', pid => {
          fs.writeFileSync(${JSON.stringify(record + ".tmp")}, JSON.stringify({command:process.pid,leaf:pid,owner:Number(process.env.REVIEW_CONTRACT_OWNER)}));
          fs.renameSync(${JSON.stringify(record + ".tmp")}, ${JSON.stringify(record)});
          if (${JSON.stringify(mode === "success" || mode === "failure" || mode === "cleanup-timeout")}) {
            process.stderr.write('fixture stderr\\n');
            process.stdout.write('fixture stdout\\n', () => process.exit(${mode === "failure" ? 7 : 0}));
          }
        });
        setInterval(()=>{},1000);
      `;
        const owner = `
        import { runReviewProcess } from ${JSON.stringify(new URL("./review-evidence.test-support.mjs", import.meta.url).href)};
        await runReviewProcess(process.execPath, ['-e', ${JSON.stringify(command)}], {env:{...process.env,REVIEW_CONTRACT_OWNER:String(process.pid)}});
      `;
        const result = await runReviewProcess(
          process.execPath,
          ownerInterrupted
            ? ["--input-type=module", "-e", owner]
            : ["-e", command],
          {
            cwd,
            env: { ...process.env, REVIEW_CONTRACT_OWNER: String(process.pid) },
            timeoutMilliseconds:
              mode === "timeout" || mode === "cleanup-timeout" ? 1500 : 15000,
            signal: interruption.signal,
          },
        );
        assert.ok(
          existsSync(record),
          "descendant reached readiness before the failure budget",
        );
        const tree = treeSchema.parse(JSON.parse(readFileSync(record, "utf8")));
        for (const pid of [
          tree.command,
          tree.leaf,
          ...(ownerInterrupted ? [tree.owner] : []),
        ])
          assert.equal(
            alive(pid),
            false,
            `owned process ${pid} is gone before fixture removal`,
          );
        assert.equal(
          result.timedOut,
          mode === "timeout" || mode === "cleanup-timeout",
        );
        assert.equal(result.interrupted, mode === "abort");
        if (mode === "success" || mode === "failure") {
          assert.equal(result.status, mode === "success" ? 0 : 7);
          assert.equal(result.stdout, "fixture stdout\n");
          assert.equal(result.stderr, "fixture stderr\n");
        } else if (mode === "timeout" || mode === "cleanup-timeout") {
          assert.equal(result.status, 124);
        } else if (mode === "abort") {
          assert.equal(result.status, 130);
        } else assert.notEqual(result.status, 0);
      } finally {
        clearTimeout(rescue);
        watcher.close();
        // Failure fallback also owns cleanup when demonstrating a missing runner budget.
        if (existsSync(record)) {
          const tree = treeSchema.parse(
            JSON.parse(readFileSync(record, "utf8")),
          );
          for (const pid of [
            tree.command,
            tree.leaf,
            ...(ownerInterrupted ? [tree.owner] : []),
          ])
            if (alive(pid)) process.kill(pid, "SIGKILL");
        }
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
}
