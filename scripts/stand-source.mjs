// @ts-check
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const liveWebDirectories = [
  "apps/web/app",
  "apps/web/src",
  "apps/web/public",
];

/** @param {string} value */
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Read content, not Git status timestamps: two dirty working trees may have the same HEAD.
 * Ignored build output and local evidence never enter the input list.
 * @param {string} root
 * @param {{ git?: (args: string[]) => string; environment?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<import("./stand-controller.mjs").StandSource>}
 */
export async function readStandSource(
  root,
  {
    git = (args) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 16 * 1024 * 1024,
      }),
    environment = process.env,
  } = {},
) {
  const files = [
    ...new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  /** @type {{path: string; hash: string}[]} */
  const entries = [];
  /** @type {Set<string>} */
  const variables = new Set();
  for (const path of files) {
    if (
      path
        .split("/")
        .some((part) =>
          [
            ".git",
            ".github",
            ".identity-proof",
            ".reports",
            "node_modules",
            ".next",
            "dist",
            "coverage",
            "storybook-static",
            "test-results",
            "playwright-report",
          ].includes(part),
        ) ||
      path.endsWith(".log") ||
      path.endsWith(".tsbuildinfo")
    )
      continue;
    const full = join(root, path);
    try {
      const metadata = await lstat(full);
      if (!metadata.isFile() && !metadata.isSymbolicLink())
        throw new Error(`Unsupported stand source: ${path}`);
      const contents = metadata.isSymbolicLink()
        ? Buffer.from(await readlink(full))
        : await readFile(full);
      const hash = createHash("sha256")
        .update(String(metadata.mode & 0o777))
        .update(contents)
        .digest("hex");
      entries.push({ path, hash });
      if (
        path.endsWith(".yaml") &&
        (path.includes("compose") || path.startsWith("config/compose/"))
      ) {
        for (const match of contents
          .toString()
          .matchAll(/\$\{([A-Z][A-Z0-9_]*)/gu))
          if (match[1]) variables.add(match[1]);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        entries.push({ path, hash: "deleted" });
      else throw error;
    }
  }
  const settings = digest(
    JSON.stringify({
      envFile: await optionalFile(join(root, ".env")),
      variables: [...variables]
        .sort()
        .map((name) => [
          name,
          name === "COMPOSE_PROJECT_NAME"
            ? "inside-platform"
            : (environment[name] ?? null),
        ]),
    }),
  );
  const hashEntries = (/** @type {typeof entries} */ subset) =>
    digest(JSON.stringify([settings, subset]));
  return {
    root,
    head: git(["rev-parse", "HEAD"]).trim(),
    fingerprint: hashEntries(entries),
    build: hashEntries(
      entries.filter(
        ({ path }) =>
          !liveWebDirectories.some((directory) =>
            path.startsWith(`${directory}/`),
          ),
      ),
    ),
    schema: digest(
      JSON.stringify(
        entries.filter(
          ({ path }) =>
            path.startsWith("apps/backend/src/migrations/") ||
            path.startsWith("apps/backend/prisma/"),
        ),
      ),
    ),
    infrastructure: hashEntries(
      entries.filter(
        ({ path }) =>
          path === "compose.yaml" ||
          path.startsWith("config/compose/local/") ||
          path.startsWith("infra/identity/") ||
          path.startsWith("infra/notifications/") ||
          path.startsWith("infra/tls/"),
      ),
    ),
    identity: digest(
      (await optionalFile(
        join(
          dirname(resolve(root, git(["rev-parse", "--git-common-dir"]).trim())),
          ".identity-proof/stand.env",
        ),
      )) ?? "unconfigured",
    ),
  };
}

/** @param {string} path */
async function optionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
