// @ts-check
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { qualityCommand } from "./quality-command.mjs";

const toolSchema = z.object({
  repository: z.string().regex(/^[\w-]+\/[\w-]+$/u),
  version: z.string().regex(/^v\d+\.\d+\.\d+$/u),
  member: z
    .string()
    .regex(/^[\w.-]+(?:\/[\w.-]+)?$/u)
    .nullable(),
  assets: z.record(
    z.string(),
    z.object({
      file: z.string().regex(/^[\w.-]+$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  ),
});
const tools = z
  .record(z.string(), toolSchema)
  .parse(
    JSON.parse(
      readFileSync(new URL("./quality-tools.json", import.meta.url), "utf8"),
    ),
  );
const root = fileURLToPath(new URL("..", import.meta.url));

/** @param {Uint8Array} bytes @param {string} expected */
export function verifyToolDownload(bytes, expected) {
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error(
      "Quality tool checksum mismatch; refusing to execute downloaded bytes",
    );
}

/** Downloaded archives remain untrusted until their checked-in digest matches on every use.
 * Executables are extracted afresh, so a modified cached executable is never reused.
 * @param {string} name @param {string[]} args */
export async function runPinnedTool(name, args) {
  return withPinnedTool(name, async (executable) => {
    const execution = await qualityCommand(executable, args, {
      inherit: true,
      timeout: 300_000,
    });
    return execution.status ?? 1;
  });
}

/** @template T @param {string} name @param {(executable: string) => T | Promise<T>} run */
export async function withPinnedTool(name, run) {
  const tool = tools[name];
  const asset = tool?.assets[`${process.platform}-${process.arch}`];
  if (tool === undefined || asset === undefined)
    throw new Error(
      `Unsupported quality tool/platform: ${name} ${process.platform}-${process.arch}`,
    );
  const cache = join(root, "node_modules/.cache/quality-tools");
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, `${asset.sha256}-${asset.file}`);
  if (!existsSync(archive)) {
    const response = await fetch(
      `https://github.com/${tool.repository}/releases/download/${tool.version}/${asset.file}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok)
      throw new Error(
        `Cannot download ${name}: HTTP ${String(response.status)}`,
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    verifyToolDownload(bytes, asset.sha256);
    const partial = `${archive}.${String(process.pid)}.tmp`;
    try {
      writeFileSync(partial, bytes);
      renameSync(partial, archive);
    } finally {
      rmSync(partial, { force: true });
    }
  }
  verifyToolDownload(readFileSync(archive), asset.sha256);
  const directory = mkdtempSync(join(tmpdir(), "inside-quality-tool-"));
  try {
    let executable;
    if (tool.member === null) {
      executable = join(directory, name);
      copyFileSync(archive, executable);
    } else {
      const extraction = await qualityCommand(
        "tar",
        ["-xzf", archive, "-C", directory, tool.member],
        { timeout: 10_000 },
      );
      if (extraction.status !== 0)
        throw new Error(`Cannot extract ${name}: ${extraction.stderr}`);
      executable = join(directory, tool.member);
    }
    chmodSync(executable, 0o755);
    return await run(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [name, ...args] = process.argv.slice(2);
  if (name === undefined)
    throw new Error(
      `Expected a quality tool: ${Object.keys(tools).join(", ")}`,
    );
  process.exitCode = await runPinnedTool(basename(name), args);
}
