// @ts-check
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

const observation = z.object({
  availability: z.string(),
  value: z.string().optional(),
  truncated: z.boolean().optional(),
});
const report = z.object({
  scope: z.string(),
  availability: z.string(),
  version: z.number().optional(),
  group: z.string().optional(),
  type: observation.optional(),
  controllers: observation.optional(),
  membership: observation,
  files: z.record(z.string(), observation).default({}),
});
import { runReviewProcess } from "./review-evidence.test-support.mjs";

test("current-process cgroup memory CLI resolves v2 and v1 with bounded explicit availability (filesystem adapter)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "cgroup-observations-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Substitute only the two fixed filesystem roots in a disposable executable copy.
  // Production accepts no root override, environment path or arbitrary CLI path.
  const helper = join(root, "reader.mjs");
  const proc = join(root, "proc-cgroup");
  const sys = join(root, "cgroup");
  const source = readFileSync(
    new URL("./cgroup-memory-diagnostics.mjs", import.meta.url),
    "utf8",
  );
  writeFileSync(
    helper,
    source
      .replace('"/proc/self/cgroup"', JSON.stringify(proc))
      .replace('"/sys/fs/cgroup"', JSON.stringify(sys)),
  );
  /** @param {string} relative @param {string} value */
  const file = (relative, value) => {
    const target = join(sys, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, value);
  };
  const run = async () => {
    const result = await runReviewProcess(process.execPath, [helper], {
      timeoutMilliseconds: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    return report.parse(JSON.parse(result.stdout));
  };
  mkdirSync(sys);
  writeFileSync(proc, "0::/runner.slice/job.scope\n");
  file("cgroup.controllers", "cpu memory pids\n");
  file("runner.slice/job.scope/cgroup.type", "domain\n");
  file("runner.slice/job.scope/memory.max", "max\n");
  file("runner.slice/job.scope/memory.current", "1234\n");
  file(
    "runner.slice/job.scope/memory.events",
    "low 0\nhigh 1\nmax 2\noom 3\noom_kill 4\n",
  );
  const v2 = await run();
  assert.equal(v2.scope, "current-process");
  assert.equal(v2.version, 2);
  assert.equal(v2.group, "/runner.slice/job.scope");
  assert.equal(v2.type?.value, "domain\n");
  assert.equal(v2.files["memory.current"]?.value, "1234\n");
  assert.equal(v2.files["memory.events"]?.availability, "available");
  assert.equal(v2.controllers?.value, "cpu memory pids\n");

  writeFileSync(proc, "0::/\n");
  const rootGroup = await run();
  assert.equal(rootGroup.version, 2);
  assert.equal(
    rootGroup.files["memory.max"]?.availability,
    "not-applicable-root",
  );

  writeFileSync(proc, "5:cpu,cpuacct:/ignored\n7:memory:/runner\n");
  file("memory/runner/memory.usage_in_bytes", "4567\n");
  file("memory/runner/memory.limit_in_bytes", "8192\n");
  file("memory/runner/memory.failcnt", "2\n");
  file(
    "memory/runner/memory.oom_control",
    "oom_kill_disable 0\nunder_oom 0\noom_kill 1\n",
  );
  const v1 = await run();
  assert.equal(v1.version, 1);
  assert.equal(v1.files["memory.usage_in_bytes"]?.value, "4567\n");
  assert.equal(v1.files["memory.failcnt"]?.value, "2\n");
  writeFileSync(proc, "0::/\n7:memory:/runner\n");
  assert.equal((await run()).version, 1);

  writeFileSync(proc, "0::/missing\n");
  assert.equal((await run()).files["memory.max"]?.availability, "missing");
  writeFileSync(proc, "0::/runner.slice/job.scope\n");
  rmSync(join(sys, "runner.slice/job.scope/memory.events"));
  mkdirSync(join(sys, "runner.slice/job.scope/memory.events"));
  assert.equal((await run()).files["memory.events"]?.availability, "error");
  file("runner.slice/job.scope/memory.max", "7".repeat(5000));
  assert.equal((await run()).files["memory.max"]?.truncated, true);

  for (const row of ["0::/../../outside\n", "malformed\n", "0::/a\n0::/b\n"]) {
    writeFileSync(proc, row);
    assert.equal((await run()).availability, "unavailable");
  }
  const outside = join(root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "memory.max"), "private-sentinel");
  symlinkSync(outside, join(sys, "escape"));
  writeFileSync(proc, "0::/escape\n");
  const escaped = await run();
  assert.equal(escaped.availability, "unavailable");
  assert.doesNotMatch(JSON.stringify(escaped), /private-sentinel/u);

  rmSync(proc);
  assert.equal((await run()).membership.availability, "missing");
  const rejected = await runReviewProcess(
    process.execPath,
    [helper, "/private"],
    { timeoutMilliseconds: 5000 },
  );
  assert.equal(rejected.status, 1);
});
