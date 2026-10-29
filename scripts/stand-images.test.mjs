// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  removeStandImage,
  standImagePlan,
  usedImageIds,
} from "./stand-images.mjs";

const now = new Date("2026-10-29T12:00:00Z");
/** @param {number} n */
const id = (n) => `sha256:${n.toString(16).padStart(64, "0")}`;
/**
 * @param {number} n
 * @param {{ service?: string; project?: string; tags?: string[]; daysOld: number }} options
 */
const image = (
  n,
  { service = "api", project = "inside-platform", tags = [], daysOld },
) => ({
  Id: id(n),
  RepoTags: tags,
  Created: new Date(
    now.getTime() - daysOld * 24 * 60 * 60 * 1000,
  ).toISOString(),
  Size: 1024 ** 3,
  Config: {
    Labels: {
      "com.docker.compose.project": project,
      "com.docker.compose.service": service,
    },
  },
});

test("keeps used images and the newest unused build per service; removes older stale ones", () => {
  const plan = standImagePlan({
    images: [
      image(1, {
        tags: ["inside-platform-backend-development:local"],
        daysOld: 0,
      }),
      image(2, { daysOld: 3 }),
      image(3, { daysOld: 5 }),
      image(4, { daysOld: 20 }),
      image(5, {
        service: "logto",
        tags: ["inside/logto-proof:13"],
        daysOld: 1,
      }),
      image(6, {
        service: "logto",
        tags: ["inside/logto-proof:12"],
        daysOld: 2,
      }),
      image(7, {
        service: "logto",
        tags: ["inside/logto-proof:11"],
        daysOld: 30,
      }),
      image(8, { project: "education-platform", daysOld: 90 }),
    ],
    usedImageIds: new Set([id(1), id(5)]),
    now,
  });
  assert.deepEqual(
    plan.map(({ id: imageId, verdict }) => [imageId.slice(-1), verdict]),
    [
      ["1", "keep"],
      ["5", "keep"],
      ["6", "keep"],
      ["2", "keep"],
      ["3", "keep"],
      ["4", "remove"],
      ["7", "remove"],
    ],
  );
  assert.match(plan[2]?.reason ?? "", /rollback/u);
  assert.match(plan[4]?.reason ?? "", /younger than 7 days/u);
});

test("an unlabelled stand image is reported, never removed", () => {
  const unlabelled = {
    ...image(9, { daysOld: 60 }),
    Config: { Labels: { "com.docker.compose.project": "inside-platform" } },
  };
  assert.equal(
    standImagePlan({ images: [unlabelled], usedImageIds: new Set(), now })[0]
      ?.verdict,
    "keep",
  );
});

test("explicit recovery images survive even when older than the rollback build", () => {
  const plan = standImagePlan({
    images: [image(1, { daysOld: 1 }), image(2, { daysOld: 90 })],
    usedImageIds: new Set(),
    protectedImageIds: new Set([id(2)]),
    now,
  });
  assert.equal(plan[1]?.verdict, "keep");
  assert.match(plan[1]?.reason ?? "", /recovery/u);
});

test("preparation lifecycle owns images even when they inherit stand labels", () => {
  const prepared = image(2, { daysOld: 90 });
  const plan = standImagePlan({
    images: [
      image(1, { daysOld: 1 }),
      {
        ...prepared,
        Config: {
          Labels: {
            ...prepared.Config.Labels,
            "dev.inside.resource-preparation": "owner-token",
          },
        },
      },
    ],
    usedImageIds: new Set(),
    now,
  });
  assert.equal(plan[1]?.verdict, "keep");
  assert.match(plan[1]?.reason ?? "", /preparation/u);
});

test("removal uses immutable IDs without pruning parents or forcing, and refuses a kept image", async () => {
  /** @type {string[][]} */
  const calls = [];
  /** @param {string[]} args */
  const docker = (args) => {
    calls.push(args);
    return "";
  };
  const [tagged, untagged] = standImagePlan({
    images: [
      image(1, { daysOld: 1 }),
      image(2, { tags: ["inside/logto-proof:11"], daysOld: 30 }),
      image(3, { daysOld: 40 }),
    ],
    usedImageIds: new Set(),
    now,
  }).slice(1);
  assert.ok(tagged && untagged);
  await removeStandImage(docker, tagged);
  await removeStandImage(docker, untagged);
  assert.deepEqual(calls, [
    ["image", "rm", "--no-prune", id(2)],
    ["image", "rm", "--no-prune", id(3)],
  ]);
  assert.ok(
    calls.every((args) => !args.includes("--force") && !args.includes("-f")),
  );
  const kept = standImagePlan({
    images: [image(1, { daysOld: 1 })],
    usedImageIds: new Set(),
    now,
  })[0];
  assert.ok(kept);
  await assert.rejects(removeStandImage(docker, kept), /is kept/u);
});

test("the daemon's container count protects an image, and an unknown count keeps it", async () => {
  /** @param {string[]} args */
  const docker = (args) => {
    assert.ok(args.includes("--all"));
    assert.ok(
      args.includes("label=com.docker.compose.project=inside-platform"),
    );
    return `${id(1)}\t10\n${id(2)}\t0\n${id(3)}\tN/A\n`;
  };
  assert.deepEqual(await usedImageIds(docker), new Set([id(1), id(3)]));
});

test("an image with an unreadable creation time is never planned for removal", () => {
  assert.throws(() =>
    standImagePlan({
      images: [{ ...image(1, { daysOld: 30 }), Created: "not a date" }],
      usedImageIds: new Set(),
      now,
    }),
  );
});

test("a failing removal stops the run with the docker error", async () => {
  const [, stale] = standImagePlan({
    images: [image(1, { daysOld: 1 }), image(2, { daysOld: 30 })],
    usedImageIds: new Set(),
    now,
  });
  assert.ok(stale);
  await assert.rejects(
    removeStandImage(() => {
      throw new Error("image is being used by stopped container");
    }, stale),
    /being used/u,
  );
});
