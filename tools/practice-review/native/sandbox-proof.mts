import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { promisify } from "node:util";
export async function runSandboxWriteProbe(root: string) {
  const version = await promisify(execFile)("codex", ["--version"], {
    timeout: 5000,
    killSignal: "SIGKILL",
  });
  await mkdir(root, { recursive: true });
  const projectDir = `${root}/project-${randomUUID()}`;
  await mkdir(projectDir);
  const file = `${projectDir}/sentinel.txt`;
  await writeFile(file, "UNCHANGED\n");
  const before = await readFile(file, "utf8");
  const args = [
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--ask-for-approval",
    "never",
    "sandbox",
    "--permission-profile",
    ":read-only",
    "--cd",
    projectDir,
    "--",
    "/bin/sh",
    "-c",
    "printf CHANGED > sentinel.txt",
  ];
  const result = await new Promise<{
    code: number | string;
    stdout: string;
    stderr: string;
  }>((resolve) =>
    execFile(
      "codex",
      args,
      {
        cwd: projectDir,
        timeout: 15000,
        killSignal: "SIGKILL",
        env: { ...process.env, BASH_ENV: "/dev/null", ZDOTDIR: "/dev/null" },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : (error.code ?? "terminated"),
          stdout,
          stderr,
        });
      },
    ),
  );
  const after = await readFile(file, "utf8");
  const audit = {
    profileBaselineCliVersion: "0.157.1",
    observedCliVersion: version.stdout.trim(),
    profile: ":read-only",
    command: args,
    projectDir,
    ...result,
    unchanged: before === after,
    beforeSha: createHash("sha256").update(before).digest("hex"),
    afterSha: createHash("sha256").update(after).digest("hex"),
    scope:
      "Direct Codex native sandbox-engine probe. Separate from model execution, with built-in :read-only equivalent read-only filesystem constraints; not evidence of a model tool call.",
  };
  await writeFile(`${root}/report.json`, JSON.stringify(audit, null, 2));
  return audit;
}
