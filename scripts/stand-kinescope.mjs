// @ts-check
// The stand's real Kinescope adapter: provider access copied from the production runtime file into
// a private stand file that only api and mcp read (config/compose/local/stand-kinescope.compose.yaml).
// Callback, webhook and playback-signing secrets stay the stand's own local values.
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { standKinescopeFile } from "./stand-source.mjs";

const required = [
  "KINESCOPE_API_TOKEN",
  "KINESCOPE_PUBLIC_PROJECT_ID",
  "KINESCOPE_MEMBERSHIP_PROJECT_ID",
];
const endpoints = ["KINESCOPE_API_BASE_URL", "KINESCOPE_UPLOADER_BASE_URL"];

/**
 * The stand file contents for an environment file read from the production runtime.
 * Errors name keys, never values.
 * @param {string} source
 */
export function standKinescopeEnvironment(source) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^(KINESCOPE_[A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match?.[1] || match[2] === undefined) continue;
    const [, key, value] = match;
    if (![...endpoints, ...required].includes(key)) continue;
    if (values.has(key)) throw new Error(`${key} appears twice`);
    values.set(key, value.trim());
  }
  const missing = required.filter((key) => !values.get(key));
  if (missing.length > 0)
    throw new Error(`Missing Kinescope values: ${missing.join(", ")}`);
  for (const key of endpoints) {
    const value = values.get(key);
    if (value === undefined) continue;
    const url = URL.canParse(value) ? new URL(value) : undefined;
    if (
      url?.protocol !== "https:" ||
      !(
        url.hostname === "kinescope.io" ||
        url.hostname.endsWith(".kinescope.io")
      )
    )
      throw new Error(`${key} must be an HTTPS kinescope.io address`);
  }
  return `${[
    "KINESCOPE_PROVIDER_MODE=real",
    ...[...endpoints, ...required].flatMap((key) =>
      values.has(key) ? [`${key}=${values.get(key)}`] : [],
    ),
  ].join("\n")}\n`;
}

/** @param {string} path @param {string} contents */
export async function writeStandKinescope(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

/** @param {string} path @returns {Promise<"real" | "test">} */
export async function readStandKinescope(path) {
  try {
    return /^KINESCOPE_PROVIDER_MODE=real$/mu.test(await readFile(path, "utf8"))
      ? "real"
      : "test";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "test";
    throw error;
  }
}

/** @param {string} path */
export async function removeStandKinescope(path) {
  await rm(path, { force: true });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2] ?? "status";
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const common = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8", timeout: 10_000 },
  ).trim();
  const path = join(dirname(common), standKinescopeFile);
  try {
    if (command === "import") {
      if (process.stdin.isTTY)
        throw new Error(
          "Pipe the production runtime values: ssh inside-production \"grep '^KINESCOPE_' /etc/inside/runtime/api.env\" | pnpm stand:kinescope import",
        );
      await writeStandKinescope(
        path,
        standKinescopeEnvironment(await text(process.stdin)),
      );
    } else if (command === "remove") await removeStandKinescope(path);
    else if (command !== "status")
      throw new Error("Usage: pnpm stand:kinescope [status|import|remove]");
    const mode = await readStandKinescope(path);
    process.stdout.write(
      `Stand Kinescope adapter: ${mode}${command === "status" ? "" : "; apply with pnpm stand refresh"}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Stand Kinescope command failed"}\n`,
    );
    process.exitCode = 1;
  }
}
