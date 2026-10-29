// @ts-check
// Stale images of the shared stand (#1779). Only images the stand's own Compose project built are
// considered; volumes, the build cache, other projects and images any container uses are never
// touched. The default run only reports; `--apply` removes the listed images without force.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 *   verdict: "keep" | "remove";
 *   reason: string;
 * }} PlannedImage
 */

/**
 * Keeps every image a container uses and, per Compose service, the newest unused one as the
 * previous build for a rollback; an older unused image is stale after seven days.
 * @param {{ images: unknown[]; usedImageIds: ReadonlySet<string>; now: Date }} input
 * @returns {PlannedImage[]}
 */
export function standImagePlan({ images, usedImageIds, now }) {
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
    }))
    .sort((left, right) => right.created.getTime() - left.created.getTime());
  /** @type {Set<string>} */
  const previousKept = new Set();
  return own.map((image) => {
    if (usedImageIds.has(image.id))
      return { ...image, verdict: "keep", reason: "a container uses it" };
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
 * @param {(args: string[]) => string} docker
 */
export function usedImageIds(docker) {
  return new Set(
    docker([
      "image",
      "ls",
      "--all",
      "--no-trunc",
      "--filter",
      `label=com.docker.compose.project=${standProject}`,
      "--format",
      "{{.ID}}\t{{.Containers}}",
    ])
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [id, containers] = line.split("\t");
        return id && containers !== "0" ? [id] : [];
      }),
  );
}

/** @param {(args: string[]) => string} docker */
export function standImages(docker) {
  const ids = docker([
    "image",
    "ls",
    "--all",
    "--quiet",
    "--no-trunc",
    "--filter",
    `label=com.docker.compose.project=${standProject}`,
  ])
    .split("\n")
    .filter(Boolean);
  if (ids.length === 0) return [];
  return docker(["image", "inspect", "--format", "{{json .}}", ...new Set(ids)])
    .split("\n")
    .filter(Boolean)
    .map((line) => /** @type {unknown} */ (JSON.parse(line)));
}

/**
 * Removes one planned image without force: each tag first, then the untagged image itself.
 * @param {(args: string[]) => string} docker
 * @param {PlannedImage} image
 */
export function removeStandImage(docker, image) {
  if (image.verdict !== "remove") throw new Error(`${image.id} is kept`);
  for (const tag of image.tags) docker(["image", "rm", tag]);
  if (image.tags.length === 0) docker(["image", "rm", image.id]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const apply = process.argv.includes("--apply");
  /** @param {string[]} args */
  const docker = (args) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const release = apply
    ? await acquireLocalSetupLock(
        "Another stand operation is running; retry the image cleanup when it finishes",
      )
    : undefined;
  try {
    const plan = standImagePlan({
      images: standImages(docker),
      usedImageIds: usedImageIds(docker),
      now: new Date(),
    });
    for (const image of plan)
      process.stdout.write(
        `${image.verdict}\t${image.id.slice(7, 19)}\t${image.tags.join(",") || "<untagged>"}\t${(image.size / 1024 ** 3).toFixed(2)} GiB\t${image.reason}\n`,
      );
    const stale = plan.filter((image) => image.verdict === "remove");
    if (!apply) {
      process.stdout.write(
        `${stale.length} stale stand image(s); pnpm stand:images --apply removes them\n`,
      );
    } else {
      let removed = 0;
      for (const image of stale) {
        // Another session's plain Compose run takes no lock: check again right before removal.
        if (usedImageIds(docker).has(image.id)) {
          process.stdout.write(`keep\t${image.id.slice(7, 19)}\tnow in use\n`);
          continue;
        }
        removeStandImage(docker, image);
        removed += 1;
        process.stdout.write(`removed\t${image.id.slice(7, 19)}\n`);
      }
      process.stdout.write(`Removed ${removed} stale stand image(s)\n`);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Stand image cleanup failed"}\n`,
    );
    process.exitCode = 1;
  } finally {
    await release?.();
  }
}
