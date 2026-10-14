// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { canonical, checksum } from "./package.mjs";
import {
  checkImageProof,
  prepareImageProof,
  validateImageProof,
} from "./image-proof.mjs";

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "image-proof-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  await mkdir(state);
  /** @type {import('./package.mjs').ManifestAsset[]} */
  const assets = [];
  /** @type {Record<string, string>} */
  const variants = {};
  /** @type {Record<string, unknown>} */
  const operations = {};
  const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const names = /** @type {const} */ ([
    "wideLight",
    "wideDark",
    "tallLight",
    "tallDark",
  ]);
  for (const [index, name] of names.entries()) {
    const wide = name.startsWith("wide");
    const bytes = await sharp({
      create: {
        width: wide ? 100 : 60,
        height: wide ? 60 : 100,
        channels: 3,
        background: { r: index * 60, g: 30, b: 60 },
      },
    })
      .png()
      .toBuffer();
    const sha256 = checksum(bytes);
    const path = `${name}.png`;
    await writeFile(join(directory, path), bytes);
    assets.push({ sourceId: name, path, sha256, mimeType: "image/png" });
    variants[name] = name;
    operations[`image:${materialId}:${sha256}`] = {
      assetId: `00000000-0000-4000-8000-00000000000${index}`,
    };
  }
  const packagePath = join(directory, "package.json");
  await writeFile(
    packagePath,
    canonical({
      schemaVersion: 2,
      requiredFeatures: ["image-variants-v1"],
      sourceNamespace: "synthetic",
      selection: {
        productId: null,
        chapterIds: [],
        materialIds: ["one"],
        taskIds: [],
        complete: true,
      },
      products: [],
      assets,
      diagnostics: [],
      materials: [
        {
          sourceId: "one",
          sourcePath: "one.md",
          sourceIds: [],
          relatedMaterialIds: [],
          readingTimeMinutes: null,
          kind: "note",
          title: "One",
          summary: "Summary",
          stage: "draft",
          topicId: null,
          access: "free",
          showInFeed: false,
          difficulty: null,
          outcomes: [],
          markdown: "![Explain the mechanism](scene.png)",
          links: {},
          images: { "scene.png": "wideLight" },
          imageVariants: { "scene.png": variants },
          coverAssetId: null,
          coverAlt: null,
          video: null,
          videoChapters: [],
          artifacts: [],
        },
      ],
    }),
  );
  await writeFile(
    join(state, "journal.json"),
    canonical({
      schemaVersion: 1,
      target: "http://127.0.0.1:4398",
      materials: {
        "synthetic:one": {
          materialId,
          contentVersion: 2,
          digest: "a".repeat(64),
        },
      },
      products: {},
      operations,
    }),
  );
  const spec = {
    sourceCommit: "a".repeat(40),
    columns: [
      {
        name: "desktop",
        viewportWidth: 1280,
        viewportHeight: 900,
        columnWidth: 700,
        layout: "wide",
      },
      {
        name: "phone",
        viewportWidth: 390,
        viewportHeight: 844,
        columnWidth: 324,
        layout: "tall",
      },
    ],
    images: [
      {
        sourceId: "one",
        sourceSrc: "scene.png",
        titleRegions: {
          wide: { x: 0.1, y: 0.03, width: 0.6, height: 0.15 },
          tall: { x: 0.1, y: 0.03, width: 0.6, height: 0.15 },
        },
      },
    ],
    reusedEvidence: [],
  };
  const { manifest, path } = await prepareImageProof(packagePath, state, spec);
  const observations = {
    platformSourceCommit: "b".repeat(40),
    browser: "Synthetic fixture",
    reviewer: "Fixture reviewer",
    manifestFingerprint: manifest.fingerprint,
    sourceCommit: manifest.sourceCommit,
    packageId: manifest.packageId,
    cases: manifest.cases.map((expected) => ({
      id: expected.id,
      theme: expected.theme,
      viewportWidth: expected.viewportWidth,
      viewportHeight: expected.viewportHeight,
      columnWidth: expected.columnWidth,
      currentSrc: `http://localhost/library/materials/one/assets/${expected.targetAssetId}/images/640`,
      alt: expected.alt,
      decoded: true,
      naturalWidth: expected.sourceWidth,
      naturalHeight: expected.sourceHeight,
      imageRect: {
        x: 0,
        y: 0,
        width: expected.columnWidth,
        height:
          (expected.columnWidth * expected.sourceHeight) / expected.sourceWidth,
      },
      pageOverflow: false,
      imageOverflow: false,
      controls: expected.controls.map((state) => ({
        state,
        visible: state !== "idle" || expected.column === "phone",
        focusVisible: state === "keyboard-focus",
        opensViewer: true,
        controlRect: {
          x: expected.columnWidth - 40,
          y: 8,
          width: 32,
          height: 32,
        },
        screenshot: `${expected.id}-${state}.png`,
        screenshotSha256: "b".repeat(64),
        humanLegibility: "accepted",
        humanTitle: "accepted",
      })),
    })),
  };
  const screenshot = await readFile(join(directory, "wideLight.png"));
  for (const row of observations.cases)
    for (const control of row.controls) {
      control.screenshotSha256 = checksum(screenshot);
      await writeFile(join(directory, control.screenshot), screenshot);
    }
  const observationsPath = join(directory, "observations.json");
  await writeFile(observationsPath, JSON.stringify(observations));
  return {
    manifest,
    path,
    observations,
    observationsPath,
    directory,
    packagePath,
    state,
    spec,
  };
}

test("affected-image manifest binds all four variants and remains immutable on repeat", async (t) => {
  const f = await fixture(t);
  assert.equal(f.manifest.cases.length, 4);
  assert.deepEqual(
    f.manifest.cases.map((row) => row.expectedVariant),
    ["wideLight", "wideDark", "tallLight", "tallDark"],
  );
  assert.ok(
    f.manifest.cases.every((row) => row.alt === "Explain the mechanism"),
  );
  assert.equal(
    validateImageProof(f.manifest, f.observations).checkedVariants,
    4,
  );
  assert.equal(
    (await prepareImageProof(f.packagePath, f.state, f.spec)).path,
    f.path,
  );
});

test("wrong theme variant fails even when its PNG decodes correctly", async (t) => {
  const f = await fixture(t);
  const first = f.observations.cases[0];
  assert.ok(first);
  first.currentSrc = f.observations.cases[1]?.currentSrc ?? "";
  assert.throws(
    () => validateImageProof(f.manifest, f.observations),
    /wrong variant asset/u,
  );
});

test("actual expand control overlapping the title region fails", async (t) => {
  const f = await fixture(t);
  const first = f.observations.cases[0];
  assert.ok(first);
  const control = first.controls.find((row) => row.state === "hover");
  assert.ok(control);
  control.controlRect = { x: 100, y: 20, width: 32, height: 32 };
  assert.throws(
    () => validateImageProof(f.manifest, f.observations),
    /control obscures title hover/u,
  );
});

test("missing variants, keyboard focus and undecided human review cannot pass", async (t) => {
  const f = await fixture(t);
  const missing = structuredClone(f.observations);
  missing.cases.pop();
  assert.throws(
    () => validateImageProof(f.manifest, missing),
    /Every affected variant/u,
  );
  const first = f.observations.cases[0];
  assert.ok(first);
  const control = first.controls.find((row) => row.state === "keyboard-focus");
  assert.ok(control);
  control.focusVisible = false;
  control.humanTitle = "pending";
  assert.throws(
    () => validateImageProof(f.manifest, f.observations),
    /wrapper control failed keyboard-focus/u,
  );
  const altered = structuredClone(f.manifest);
  altered.sourceCommit = "b".repeat(40);
  assert.throws(
    () => validateImageProof(altered, f.observations),
    /manifest changed/u,
  );
});

test("proof check binds actual screenshot files and refuses changed bytes", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await checkImageProof(f.path, f.observationsPath)).checkedVariants,
    4,
  );
  const control = f.observations.cases[0]?.controls[0];
  assert.ok(control);
  await writeFile(join(f.directory, control.screenshot), "Changed screenshot");
  await assert.rejects(
    checkImageProof(f.path, f.observationsPath),
    /screenshot changed/u,
  );
});
