#!/usr/bin/env node
// @ts-check
// Release contract of the Telegram application: ordinal plan, migration identity and manifest.
// The release workflow and tests call it; the host gateway re-validates the manifest with jq.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

export const repository = "sachkov-inside/platform";
export const legacyRepository = "sachkov-inside/inside-telegram";
// Frozen source history verified at the #960 transition; newer legacy ordinals are refused.
export const legacyLastOrdinal = 5;
export const imageName = "ghcr.io/sachkov-inside/inside-telegram";
export const manifestSchemaVersion = "inside.telegram.release-manifest.v1";
export const releaseAssets = [
  "compose.yaml",
  "release-manifest.json",
  "telegram.caddy",
];
export const migrationsDirectory = fileURLToPath(
  new URL("../src/database/migrations", import.meta.url),
);

const ordinalPattern = /^v[1-9][0-9]*$/;
const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const retainedReleaseSchema = z.object({
  version: z.string(),
  immutable: z.boolean(),
  assets: z.array(z.string()),
  targetCommitish: z.string().optional(),
});
const planInputSchema = z.object({
  requestedVersion: z.string(),
  sourceSha: z.string(),
  currentMainSha: z.string(),
  legacyTags: z.array(z.string()),
  legacyReleases: z.array(retainedReleaseSchema),
  existingTags: z.array(z.string()),
  existingReleases: z.array(retainedReleaseSchema),
});

/** @param {z.infer<typeof planInputSchema>} input */
export function planRelease(input) {
  const ordinal = parseOrdinal(input.requestedVersion);
  if (!shaPattern.test(input.sourceSha)) {
    throw new Error("source SHA must be a full commit SHA");
  }
  const legacy = retainedOrdinals(
    input.legacyTags,
    input.legacyReleases,
    /^v[1-9][0-9]*$/,
    "",
  );
  if (Math.max(0, ...legacy) !== legacyLastOrdinal) {
    throw new Error(`legacy history must end at v${legacyLastOrdinal}`);
  }
  const platform = retainedOrdinals(
    input.existingTags,
    input.existingReleases,
    /^telegram-v[1-9][0-9]*$/,
    "telegram-",
  );
  if (platform.some((value) => value <= legacyLastOrdinal)) {
    throw new Error("platform Telegram history must start at telegram-v6");
  }
  const ordinals = [...legacy, ...platform];
  const nextOrdinal = Math.max(0, ...ordinals) + 1;
  for (let expected = 1; expected < nextOrdinal; expected += 1) {
    if (!ordinals.includes(expected)) {
      throw new Error(
        `ordinal history is not contiguous: missing v${expected}`,
      );
    }
  }
  if (input.sourceSha !== input.currentMainSha) {
    throw new Error("captured source SHA is not the current main");
  }
  if (ordinal !== nextOrdinal) {
    throw new Error(
      `requested ${input.requestedVersion}, but the next release is v${nextOrdinal}`,
    );
  }
  return {
    version: input.requestedVersion,
    tag: `telegram-${input.requestedVersion}`,
    sourceSha: input.sourceSha,
  };
}

/** @param {string[]} existingTags
 * @param {z.infer<typeof retainedReleaseSchema>[]} existingReleases
 * @param {RegExp} pattern
 * @param {string} prefix */
function retainedOrdinals(existingTags, existingReleases, pattern, prefix) {
  const releases = existingReleases.filter(({ version }) =>
    pattern.test(version),
  );
  for (const release of releases) {
    if (!release.immutable)
      throw new Error(`${release.version} is not an immutable release`);
    if (
      JSON.stringify([...release.assets].sort()) !==
      JSON.stringify([...releaseAssets].sort())
    ) {
      throw new Error(
        `${release.version} must have exactly the Telegram release assets`,
      );
    }
    if (
      release.targetCommitish === undefined ||
      !shaPattern.test(release.targetCommitish)
    ) {
      throw new Error(`${release.version} target must be a full commit SHA`);
    }
  }
  const versions = releases.map(({ version }) => version);
  const tags = [...new Set(existingTags.filter((tag) => pattern.test(tag)))];
  if (
    JSON.stringify([...tags].sort()) !== JSON.stringify([...versions].sort())
  ) {
    throw new Error("ordinal Git tags must exactly match immutable releases");
  }
  return versions.map((version) => parseOrdinal(version.slice(prefix.length)));
}

/**
 * Identity of the ordered migration set: names and contents of every file.
 * Equal identities mean that two releases expect the same database schema.
 */
export async function migrationsIdentity(directory = migrationsDirectory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (names.length === 0) {
    throw new Error(`no migrations in ${directory}`);
  }
  const lines = [];
  for (const name of names) {
    const content = await readFile(path.join(directory, name));
    lines.push(`${name}\t${sha256Hex(content)}\n`);
  }
  return {
    identity: `sha256:${sha256Hex(lines.join(""))}`,
    count: names.length,
    latest: names.at(-1),
  };
}

/**
 * @param {{version: string, sourceSha: string, imageDigest: string,
 *   composePath: string, caddyPath: string, migrationsDirectory?: string,
 *   workflowRunId: number,
 *   serverUrl: string}} input
 */
export async function createManifest(input) {
  if (parseOrdinal(input.version) <= legacyLastOrdinal) {
    throw new Error("new manifests must start at v6 in platform");
  }
  if (!shaPattern.test(input.sourceSha)) {
    throw new Error("source SHA must be a full commit SHA");
  }
  if (!digestPattern.test(input.imageDigest)) {
    throw new Error("image digest must be sha256:<64 hex>");
  }
  if (!Number.isSafeInteger(input.workflowRunId) || input.workflowRunId < 1) {
    throw new Error("publication workflow run id must be a positive integer");
  }
  if (input.serverUrl !== "https://github.com")
    throw new Error("untrusted publication server");
  const compose = await readFile(input.composePath);
  const caddy = await readFile(input.caddyPath);
  return {
    schemaVersion: manifestSchemaVersion,
    version: input.version,
    source: { repository, sha: input.sourceSha },
    image: `${imageName}@${input.imageDigest}`,
    migrations: await migrationsIdentity(input.migrationsDirectory),
    compose: { asset: "compose.yaml", sha256: `sha256:${sha256Hex(compose)}` },
    caddy: { asset: "telegram.caddy", sha256: `sha256:${sha256Hex(caddy)}` },
    publication: {
      workflowRunId: input.workflowRunId,
      workflowRunUrl: `${input.serverUrl}/${repository}/actions/runs/${input.workflowRunId}`,
    },
  };
}

/** @param {unknown} version */
function parseOrdinal(version) {
  if (typeof version !== "string" || !ordinalPattern.test(version)) {
    throw new Error(`release version must be vN, got ${String(version)}`);
  }
  const ordinal = Number(version.slice(1));
  if (!Number.isSafeInteger(ordinal))
    throw new Error("release ordinal is too large");
  return ordinal;
}

/** @param {string | Uint8Array} value */
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readStandardInput() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    if (typeof chunk !== "string")
      throw new Error("expected UTF-8 standard input");
    text += chunk;
  }
  return text;
}

/** @param {string[]} arguments_
 * @param {string} name */
function option(arguments_, name) {
  const index = arguments_.indexOf(`--${name}`);
  const value = index === -1 ? undefined : arguments_[index + 1];
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

/** @param {string[]} arguments_ */
async function main(arguments_) {
  const [command, ...rest] = arguments_;
  if (command === "plan") {
    return planRelease(
      planInputSchema.parse(JSON.parse(await readStandardInput())),
    );
  }
  if (command === "migrations-identity") {
    return migrationsIdentity(rest[0]);
  }
  if (command === "manifest") {
    return createManifest({
      version: option(rest, "version"),
      sourceSha: option(rest, "source-sha"),
      imageDigest: option(rest, "image-digest"),
      composePath: option(rest, "compose"),
      caddyPath: option(rest, "caddy"),
      workflowRunId: Number(option(rest, "run-id")),
      serverUrl: option(rest, "server-url"),
    });
  }
  throw new Error(
    "usage: release-contract.mjs plan | migrations-identity [dir] | manifest --version vN --source-sha <sha> --image-digest <digest> --compose <file> --caddy <file> --run-id <id> --server-url <url>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await main(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release contract: ${message}\n`);
    process.exitCode = 1;
  }
}
