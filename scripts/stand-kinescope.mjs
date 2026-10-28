// @ts-check
// The stand's real Kinescope adapter: provider access copied from the production runtime file into
// a private stand file that only api and mcp read (config/compose/local/stand-kinescope.compose.yaml).
// Callback, webhook and playback-signing secrets stay the stand's own local values.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { standKinescopeFile } from "./stand-source.mjs";

// Provider access the stand copies, in file order; everything else stays the stand's own value.
// A hand parser refuses duplicate keys, which the dotenv parsers silently resolve.
const endpoints = ["KINESCOPE_API_BASE_URL", "KINESCOPE_UPLOADER_BASE_URL"];
const providerAccess = [
  "KINESCOPE_API_TOKEN",
  "KINESCOPE_PUBLIC_PROJECT_ID",
  "KINESCOPE_MEMBERSHIP_PROJECT_ID",
];
const copiedKeys = [...endpoints, ...providerAccess];

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
    if (!copiedKeys.includes(key)) continue;
    if (values.has(key)) throw new Error(`${key} appears twice`);
    values.set(key, value.trim());
  }
  const missing = providerAccess.filter((key) => !values.get(key));
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
    ...copiedKeys.flatMap((key) =>
      values.has(key) ? [`${key}=${values.get(key)}`] : [],
    ),
  ].join("\n")}\n`;
}

// The stand's own Ed25519 preview key (#1808): production holds only the public half and accepts
// the stand's short author previews of protected recordings with it.
const previewPrivateKey = "KINESCOPE_STAND_PREVIEW_PRIVATE_KEY";
const previewPublicKey = "KINESCOPE_STAND_PREVIEW_PUBLIC_KEY";

/**
 * The stand file with its preview key, generated once and kept across imports. Returns the
 * public half for production; the private half never leaves the file.
 * @param {string} current the stand file's contents
 * @param {() => { privateKey: string; publicKey: string }} [generate]
 */
export function withStandPreviewKey(current, generate = generatePreviewKey) {
  const kept = standPreviewLines(current);
  const publicKey = kept
    .find((line) => line.startsWith(`${previewPublicKey}=`))
    ?.slice(previewPublicKey.length + 1);
  if (kept.length === 2 && publicKey) return { contents: current, publicKey };
  if (kept.length > 0)
    throw new Error(
      `The stand file holds an incomplete preview key; remove ${previewPrivateKey} and ${previewPublicKey} and retry`,
    );
  const pair = generate();
  return {
    contents: `${current.trimEnd()}\n${previewPrivateKey}=${pair.privateKey}\n${previewPublicKey}=${pair.publicKey}\n`,
    publicKey: pair.publicKey,
  };
}

/** @param {string} current */
export function standPreviewLines(current) {
  return current
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line.startsWith(`${previewPrivateKey}=`) ||
        line.startsWith(`${previewPublicKey}=`),
    );
}

function generatePreviewKey() {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ format: "jwk" }).d;
  const publicKey = pair.publicKey.export({ format: "jwk" }).x;
  if (!privateKey || !publicKey)
    throw new Error("Ed25519 key generation returned no key");
  return { privateKey, publicKey };
}

/** @param {string} path @returns {Promise<string>} the file, or empty when there is none */
async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "";
    throw error;
  }
}

/** @param {string} path @param {string} contents */
export async function writeStandKinescope(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
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

// Test-adapter Videos keep the stand's placeholder projects. Once the real projects are configured,
// a Save that keeps such a reference fails with `video_provider_mismatch`, and the recording never
// played. Detaching them is what the editor's detach does; the Video rows stay for audit. The
// count names the Materials whose draft lost such a reference.
export const detachTestVideosSql = `\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMPORARY TABLE stand_test_videos ON COMMIT DROP AS
  SELECT id FROM videos.videos WHERE project_id LIKE 'inside-local-%' AND deleted_at IS NULL;
CREATE TEMPORARY TABLE stand_detached_materials ON COMMIT DROP AS
  SELECT id FROM materials.materials
  WHERE primary_video_id IN (SELECT id FROM stand_test_videos);
-- Chapters require a Video; the domain's detach clears them with the reference.
UPDATE materials.materials SET primary_video_id = NULL, video_chapters = '[]'::jsonb
  WHERE id IN (SELECT id FROM stand_detached_materials);
UPDATE materials.published_materials SET primary_video_id = NULL
  WHERE primary_video_id IN (SELECT id FROM stand_test_videos);
UPDATE videos.videos SET detached_at = now()
  WHERE id IN (SELECT id FROM stand_test_videos) AND detached_at IS NULL;
SELECT 'detached ' || count(*) FROM stand_detached_materials;
COMMIT;
`;

/**
 * @param {(args: string[], input?: string) => string} docker
 * @returns {string} a one-line count, never row contents
 */
export function detachTestVideos(docker) {
  const container = docker([
    "ps",
    "--quiet",
    "--filter",
    "label=com.docker.compose.project=inside-platform",
    "--filter",
    "label=com.docker.compose.service=postgres",
  ]).trim();
  if (!/^[0-9a-f]+$/u.test(container))
    throw new Error("The stand database is not running");
  const output = docker(
    [
      "exec",
      "-i",
      container,
      "sh",
      "-c",
      'exec psql -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    ],
    detachTestVideosSql,
  );
  const line = /^detached \d+$/mu.exec(output)?.[0];
  if (!line) throw new Error("The stand database did not confirm the detach");
  return line;
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
          "Pipe the production runtime values: ssh inside-production \"grep -E '^KINESCOPE_(API_TOKEN|PUBLIC_PROJECT_ID|MEMBERSHIP_PROJECT_ID|API_BASE_URL|UPLOADER_BASE_URL)=' /etc/inside/runtime/api.env\" | pnpm stand:kinescope import",
        );
      // A fresh import keeps the stand's preview key, which production already trusts.
      const kept = standPreviewLines(await readOptional(path));
      await writeStandKinescope(
        path,
        `${standKinescopeEnvironment(await text(process.stdin))}${kept.map((line) => `${line}\n`).join("")}`,
      );
    } else if (command === "preview-key") {
      if ((await readStandKinescope(path)) !== "real")
        throw new Error(
          "The preview key serves the real adapter only; import first",
        );
      const { contents, publicKey } = withStandPreviewKey(
        await readFile(path, "utf8"),
      );
      await writeStandKinescope(path, contents);
      // The public half is no secret: the owner adds this line to production's api.env.
      process.stdout.write(`${previewPublicKey}=${publicKey}\n`);
    } else if (command === "remove") await removeStandKinescope(path);
    else if (command === "detach-test-videos") {
      if ((await readStandKinescope(path)) !== "real")
        throw new Error(
          "Test-adapter Videos still play their role under the test adapter; import first",
        );
      const result = detachTestVideos((args, input) =>
        execFileSync("docker", args, {
          encoding: "utf8",
          timeout: 60_000,
          ...(input === undefined ? {} : { input }),
          stdio: ["pipe", "pipe", "ignore"],
        }),
      );
      process.stdout.write(`Stand test-adapter Videos ${result}\n`);
    } else if (command !== "status")
      throw new Error(
        "Usage: pnpm stand:kinescope [status|import|preview-key|remove|detach-test-videos]",
      );
    const mode = await readStandKinescope(path);
    // The file selects the adapter for roles created after it; running roles change on refresh.
    process.stdout.write(
      `Stand Kinescope file: ${mode}; running roles follow it after pnpm stand refresh\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Stand Kinescope command failed"}\n`,
    );
    process.exitCode = 1;
  }
}
