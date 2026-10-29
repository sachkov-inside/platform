// @ts-check
// Stale images of the shared stand (#1779). Only images the stand's own Compose project built are
// considered; volumes, the build cache, other projects and images any container uses are never
// touched. The default run only reports; `--apply` removes the listed images without force.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

export const standProject = "inside-platform";
/** An image this young may belong to a build still under review. */
export const minimumStaleAgeDays = 7;
const minimumStaleAgeMilliseconds = minimumStaleAgeDays * 24 * 60 * 60 * 1000;

const imageSchema = z.object({
  Id: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  RepoTags: z.array(z.string()).nullable(),
  Created: z.iso.datetime({ offset: true }),
  Size: z.number(),
  Config: z.object({
    Labels: z.record(z.string(), z.string()).nullable(),
  }),
});

/**
 * @typedef {{
 *   id: string;
 *   tags: string[];
 *   service: string;
 *   created: Date;
 *   size: number;
 *   preparationOwned: boolean;
 *   verdict: "keep" | "remove";
 *   reason: string;
 * }} PlannedImage
 */

/**
 * Keeps every image a container uses and, per Compose service, the newest unused one as the
 * previous build for a rollback; an older unused image is stale after seven days.
 * @param {{ images: unknown[]; usedImageIds: ReadonlySet<string>; protectedImageIds?: ReadonlySet<string>; now: Date }} input
 * @returns {PlannedImage[]}
 */
export function standImagePlan({
  images,
  usedImageIds,
  protectedImageIds = new Set(),
  now,
}) {
  const own = images
    .map((raw) => imageSchema.parse(raw))
    .filter((image) => {
      const labels = image.Config.Labels ?? {};
      return labels["com.docker.compose.project"] === standProject;
    })
    .map((image) => ({
      id: image.Id,
      tags: (image.RepoTags ?? []).filter((tag) => tag !== "<none>:<none>"),
      service: image.Config.Labels?.["com.docker.compose.service"] ?? "",
      created: new Date(image.Created),
      size: image.Size,
      preparationOwned: Object.hasOwn(
        image.Config.Labels ?? {},
        "dev.inside.resource-preparation",
      ),
    }))
    .sort((left, right) => right.created.getTime() - left.created.getTime());
  /** @type {Set<string>} */
  const previousKept = new Set();
  return own.map((image) => {
    if (usedImageIds.has(image.id))
      return { ...image, verdict: "keep", reason: "a container uses it" };
    if (protectedImageIds.has(image.id))
      return { ...image, verdict: "keep", reason: "explicit recovery image" };
    if (image.preparationOwned)
      return {
        ...image,
        verdict: "keep",
        reason: "owned by preparation lifecycle",
      };
    if (image.service === "")
      return { ...image, verdict: "keep", reason: "no Compose service label" };
    if (!previousKept.has(image.service)) {
      previousKept.add(image.service);
      return {
        ...image,
        verdict: "keep",
        reason: `newest unused ${image.service} image, kept for a rollback`,
      };
    }
    if (now.getTime() - image.created.getTime() < minimumStaleAgeMilliseconds)
      return {
        ...image,
        verdict: "keep",
        reason: `younger than ${minimumStaleAgeDays} days`,
      };
    return {
      ...image,
      verdict: "remove",
      reason: `older unused ${image.service} image`,
    };
  });
}

/**
 * The stand images any container, running or stopped, uses. The daemon's own count is the
 * authority: with the containerd store a container names a platform manifest or config digest,
 * not the image ID. An image whose count the daemon cannot give is treated as used.
 * @param {(args: string[]) => string | Promise<string>} docker
 */
export async function usedImageIds(docker) {
  return new Set(
    (
      await docker([
        "image",
        "ls",
        "--all",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${standProject}`,
        "--format",
        "{{.ID}}\t{{.Containers}}",
      ])
    )
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [id, containers] = line.split("\t");
        return id && containers !== "0" ? [id] : [];
      }),
  );
}

/** @param {(args: string[]) => string | Promise<string>} docker */
export async function standImages(docker) {
  const ids = (
    await docker([
      "image",
      "ls",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=com.docker.compose.project=${standProject}`,
    ])
  )
    .split("\n")
    .filter(Boolean);
  if (ids.length === 0) return [];
  return (
    await docker([
      "image",
      "inspect",
      "--format",
      "{{json .}}",
      ...new Set(ids),
    ])
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => /** @type {unknown} */ (JSON.parse(line)));
}

/**
 * Removes only the planned immutable image, without force or implicit parent pruning.
 * Docker refuses images with multiple repository references; those need their owner's handoff.
 * @param {(args: string[]) => string | Promise<string>} docker
 * @param {PlannedImage} image
 */
export async function removeStandImage(docker, image) {
  if (image.verdict !== "remove") throw new Error(`${image.id} is kept`);
  await docker(["image", "rm", "--no-prune", image.id]);
}

const dockerCommandTimeoutMilliseconds = 120_000;
const executeFile = promisify(execFile);

/** @param {string[]} args */
async function executeDockerCommand(args) {
  const { stdout } = await executeFile("docker", args, {
    encoding: "utf8",
    timeout: dockerCommandTimeoutMilliseconds,
  });
  return stdout;
}

/**
 * Command boundary. Docker stays asynchronous so the shared lock can renew during slow calls.
 * Tests replace only external I/O, the clock and their isolated lock/default-manifest paths.
 * @param {{args?: string[]; executeDocker?: (args: string[]) => Promise<string>; now?: () => Date; write?: (line: string) => void; lockTarget?: string; defaultProtectionFile?: string}} [options]
 */
export async function runStandImages({
  args = process.argv.slice(2),
  executeDocker = executeDockerCommand,
  now = () => new Date(),
  write = (line) => {
    process.stdout.write(line);
  },
  lockTarget,
  defaultProtectionFile = join(
    homedir(),
    ".local/state/platform-orbstack/1527/optimization/protected-images.json",
  ),
} = {}) {
  /** @type {(() => Promise<void>) | undefined} */
  let release;
  try {
    const { values } = parseArgs({
      args,
      options: {
        apply: { type: "boolean", default: false },
        context: { type: "string" },
        "daemon-id": { type: "string" },
        "protected-images": { type: "string" },
      },
    });
    const apply = values.apply;
    const context = values.context;
    const protectedFile = values["protected-images"] ?? defaultProtectionFile;
    let protectionFileSeen = false;
    const protectedIds = async () => {
      try {
        const raw = await readFile(protectedFile, "utf8");
        protectionFileSeen = true;
        return new Set(
          z
            .array(imageSchema.shape.Id)
            .parse(/** @type {unknown} */ (JSON.parse(raw))),
        );
      } catch (error) {
        if (
          values["protected-images"] === undefined &&
          !protectionFileSeen &&
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return new Set();
        throw error;
      }
    };
    // An absent legacy default is allowed on other machines. Explicit paths always fail closed.
    await protectedIds();
    /** @param {string[]} command */
    const docker = (command) =>
      executeDocker(
        context === undefined ? command : ["--context", context, ...command],
      );
    if (apply)
      release = await acquireLocalSetupLock(
        "Another stand operation is running; retry the image cleanup when it finishes",
        lockTarget,
      );
    const daemonId = (await docker(["info", "--format", "{{.ID}}"])).trim();
    if (!daemonId) throw new Error("Docker daemon identity is unavailable");
    if (values["daemon-id"] !== undefined && values["daemon-id"] !== daemonId)
      throw new Error(
        "Docker daemon does not match the maintenance installation",
      );
    const plan = standImagePlan({
      images: await standImages(docker),
      usedImageIds: await usedImageIds(docker),
      protectedImageIds: await protectedIds(),
      now: now(),
    });
    for (const image of plan)
      write(
        `${image.verdict}\t${image.id.slice(7, 19)}\t${image.tags.join(",") || "<untagged>"}\t${(image.size / 1024 ** 3).toFixed(2)} GiB\t${image.reason}\n`,
      );
    const stale = plan.filter((image) => image.verdict === "remove");
    if (!apply) {
      write(
        `${stale.length} stale stand image(s); rerun this command with --apply to remove them\n`,
      );
    } else {
      let removed = 0;
      for (const image of stale) {
        // Plain Compose and protection changes may bypass our cooperative lock. Re-plan by ID.
        const current = standImagePlan({
          images: await standImages(docker),
          usedImageIds: await usedImageIds(docker),
          protectedImageIds: await protectedIds(),
          now: now(),
        }).find((candidate) => candidate.id === image.id);
        if (!current || current.verdict === "keep") {
          write(
            `keep\t${image.id.slice(7, 19)}\t${current?.reason ?? "no longer present"}\n`,
          );
          continue;
        }
        if ((await docker(["info", "--format", "{{.ID}}"])).trim() !== daemonId)
          throw new Error("Docker daemon changed; refusing image cleanup");
        await removeStandImage(docker, current);
        removed += 1;
        write(`removed\t${image.id.slice(7, 19)}\n`);
      }
      write(`Removed ${removed} stale stand image(s)\n`);
    }
  } finally {
    await release?.();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runStandImages();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Stand image cleanup failed"}\n`,
    );
    process.exitCode = 1;
  }
}
