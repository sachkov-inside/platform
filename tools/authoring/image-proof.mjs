// @ts-check
import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { canonical, checksum, fileChecksum, loadPackage } from "./package.mjs";
import { convertMarkdown } from "./markdown.mjs";
import { imageSourceKey, resolveImageVariants } from "./image-variants.mjs";
import { parseJournal, assetReceiptSchema } from "./local-boundaries.mjs";
import { writeImmutable } from "./preservation.mjs";

const rect = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const region = rect.refine(
  (r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 && r.y + r.height <= 1,
  "Title region must fit the normalized image",
);
const variant = z.enum(["wideLight", "wideDark", "tallLight", "tallDark"]);
export const imageProofSpecSchema = z
  .object({
    sourceCommit: z.hash("sha1"),
    columns: z
      .array(
        z
          .object({
            name: z.enum(["desktop", "phone"]),
            viewportWidth: z.number().int().positive(),
            viewportHeight: z.number().int().positive(),
            columnWidth: z.number().positive(),
            layout: z.enum(["wide", "tall"]),
          })
          .strict(),
      )
      .length(2)
      .refine(
        (rows) =>
          new Set(rows.map((row) => row.name)).size === 2 &&
          new Set(rows.map((row) => row.layout)).size === 2,
        "Specify desktop/wide and phone/tall columns",
      )
      .refine((rows) =>
        rows.every((row) =>
          row.name === "desktop"
            ? row.layout === "wide"
            : row.layout === "tall",
        ),
      ),
    images: z
      .array(
        z
          .object({
            sourceId: z.string().min(1),
            sourceSrc: z.string().min(1),
            titleRegions: z.object({ wide: region, tall: region }).strict(),
          })
          .strict(),
      )
      .min(1),
    reusedEvidence: z.array(z.string().min(1)).default([]),
  })
  .strict();
const caseSchema = z
  .object({
    id: z.hash("sha256"),
    sourceId: z.string(),
    sourcePath: z.string(),
    sourceSrc: z.string(),
    alt: z.string().min(1),
    column: z.enum(["desktop", "phone"]),
    viewportWidth: z.number().positive(),
    viewportHeight: z.number().positive(),
    columnWidth: z.number().positive(),
    theme: z.enum(["light", "dark"]),
    expectedVariant: variant,
    assetSourceId: z.string(),
    assetPath: z.string(),
    assetSha256: z.hash("sha256"),
    targetAssetId: z.uuid(),
    sourceWidth: z.number().positive(),
    sourceHeight: z.number().positive(),
    titleRegion: region,
    controls: z.array(z.enum(["idle", "hover", "keyboard-focus"])).length(3),
  })
  .strict();
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceCommit: z.hash("sha1"),
    packageId: z.hash("sha256"),
    packagePath: z.string(),
    cases: z.array(caseSchema).min(1),
    reusedEvidence: z.array(z.string()),
    fingerprint: z.hash("sha256"),
  })
  .strict();
const observationSchema = z
  .object({
    platformSourceCommit: z.hash("sha1"),
    browser: z.string().min(1),
    reviewer: z.string().min(1),
    manifestFingerprint: z.hash("sha256"),
    sourceCommit: z.hash("sha1"),
    packageId: z.hash("sha256"),
    cases: z.array(
      z
        .object({
          id: z.hash("sha256"),
          theme: z.enum(["light", "dark"]),
          viewportWidth: z.number(),
          viewportHeight: z.number(),
          columnWidth: z.number(),
          currentSrc: z.url(),
          alt: z.string(),
          decoded: z.boolean(),
          naturalWidth: z.number(),
          naturalHeight: z.number(),
          imageRect: rect,
          pageOverflow: z.boolean(),
          imageOverflow: z.boolean(),
          controls: z
            .array(
              z
                .object({
                  state: z.enum(["idle", "hover", "keyboard-focus"]),
                  visible: z.boolean(),
                  focusVisible: z.boolean(),
                  opensViewer: z.boolean(),
                  controlRect: rect.nullable(),
                  screenshot: z.string().min(1),
                  screenshotSha256: z.hash("sha256"),
                  humanLegibility: z.enum(["accepted", "rejected", "pending"]),
                  humanTitle: z.enum(["accepted", "rejected", "pending"]),
                })
                .strict(),
            )
            .length(3),
        })
        .strict(),
    ),
  })
  .strict();

/** Derive affected variants from package declarations and the applied upload receipts.
 * @param {string} packagePath @param {string} stateDirectory @param {unknown} input */
export async function prepareImageProof(packagePath, stateDirectory, input) {
  const spec = imageProofSpecSchema.parse(input);
  const pkg = await loadPackage(packagePath);
  const journal = parseJournal(
    JSON.parse(await readFile(join(stateDirectory, "journal.json"), "utf8")),
  );
  /** @type {z.infer<typeof caseSchema>[]} */
  const cases = [];
  const selections = new Set();
  const pages = pkg.manifest.materials;
  for (const selected of spec.images) {
    const selection = `${selected.sourceId}:${selected.sourceSrc}`;
    if (selections.has(selection)) throw new Error("Duplicate affected image");
    selections.add(selection);
    const page = pages.find((row) => row.sourceId === selected.sourceId);
    const sourceSrc =
      page === undefined
        ? undefined
        : imageSourceKey(page.imageVariants ?? {}, selected.sourceSrc);
    const variants =
      sourceSrc === undefined ? undefined : page?.imageVariants?.[sourceSrc];
    if (page === undefined || sourceSrc === undefined || variants === undefined)
      throw new Error(`Unknown affected image: ${selection}`);
    const document = convertMarkdown(page.markdown, {
      sourcePath: page.sourcePath,
      sourceId: page.sourceId,
      readerBlocks: page.readerBlocks,
      link: (href) => href,
      image: (href) => {
        const key = imageSourceKey(page.images, href);
        if (key === undefined) throw new Error("Undeclared image");
        return page.images[key] ?? "";
      },
      imageVariants: (href) =>
        resolveImageVariants(
          page,
          href,
          new Map(
            pkg.manifest.assets.map((asset) => [
              asset.sourceId,
              asset.sourceId,
            ]),
          ),
        ),
    });
    /** @type {string[]} */
    const alts = [];
    /** @param {import('./markdown.mjs').DocNode} node */
    const visit = (node) => {
      if (node.type === "assetImage" && node.attrs?.["sourceSrc"] === sourceSrc)
        alts.push(z.string().min(1).parse(node.attrs["alt"]));
      for (const child of node.content ?? []) visit(child);
    };
    visit(document.doc);
    if (alts.length !== 1)
      throw new Error(
        `Affected image needs one unambiguous rendered ALT: ${selection}`,
      );
    const material =
      journal.materials[`${pkg.manifest.sourceNamespace}:${page.sourceId}`];
    const ownerId = material?.materialId;
    if (ownerId === undefined)
      throw new Error(`Missing image owner identity: ${selection}`);
    for (const column of spec.columns)
      for (const theme of /** @type {const} */ (["light", "dark"])) {
        const expectedVariant = variant.parse(
          `${column.layout}${theme === "light" ? "Light" : "Dark"}`,
        );
        const assetId = variants[expectedVariant];
        const asset = pkg.manifest.assets.find(
          (asset) => asset.sourceId === assetId,
        );
        if (asset === undefined || asset.mimeType !== "image/png")
          throw new Error("Affected proof currently requires PNG variants");
        const upload = assetReceiptSchema.parse(
          journal.operations[`image:${ownerId}:${asset.sha256}`],
        );
        const dimensions = await sharp(
          join(pkg.directory, asset.path),
        ).metadata();
        const row = {
          sourceId: page.sourceId,
          sourcePath: page.sourcePath,
          sourceSrc,
          alt: alts[0],
          column: column.name,
          viewportWidth: column.viewportWidth,
          viewportHeight: column.viewportHeight,
          columnWidth: column.columnWidth,
          theme,
          expectedVariant,
          assetSourceId: asset.sourceId,
          assetPath: asset.path,
          assetSha256: asset.sha256,
          targetAssetId: upload.assetId,
          sourceWidth: dimensions.width,
          sourceHeight: dimensions.height,
          titleRegion: selected.titleRegions[column.layout],
          controls: ["idle", "hover", "keyboard-focus"],
        };
        cases.push(caseSchema.parse({ ...row, id: checksum(canonical(row)) }));
      }
  }
  const plan = {
    schemaVersion: 1,
    sourceCommit: spec.sourceCommit,
    packageId: pkg.id,
    packagePath: resolve(packagePath),
    cases,
    reusedEvidence: spec.reusedEvidence,
  };
  const manifest = manifestSchema.parse({
    ...plan,
    fingerprint: checksum(canonical(plan)),
  });
  const path = join(
    resolve(stateDirectory),
    "image-proofs",
    `${manifest.fingerprint}.json`,
  );
  await writeImmutable(path, manifest);
  return { path, manifest };
}

/** Validate captured facts. Human title/legibility decisions remain separate, explicit gates.
 * @param {unknown} input @param {unknown} observations */
export function validateImageProof(input, observations) {
  const manifest = manifestSchema.parse(input);
  const { fingerprint, ...plan } = manifest;
  if (checksum(canonical(plan)) !== fingerprint)
    throw new Error("Image proof manifest changed");
  const proof = observationSchema.parse(observations);
  if (
    proof.manifestFingerprint !== fingerprint ||
    proof.sourceCommit !== manifest.sourceCommit ||
    proof.packageId !== manifest.packageId
  )
    throw new Error(
      "Image observations belong to another source/package/manifest",
    );
  if (
    proof.cases.length !== manifest.cases.length ||
    new Set(proof.cases.map((row) => row.id)).size !== proof.cases.length
  )
    throw new Error("Every affected variant needs exactly one observation");
  /** @type {string[]} */
  const failures = [];
  for (const expected of manifest.cases) {
    const observed = proof.cases.find((row) => row.id === expected.id);
    if (observed === undefined) {
      failures.push(`${expected.id}: missing observation`);
      continue;
    }
    const src = new URL(observed.currentSrc);
    if (
      src.pathname.split("/assets/")[1]?.split("/")[0] !==
      expected.targetAssetId
    )
      failures.push(`${expected.id}: wrong variant asset`);
    if (
      observed.theme !== expected.theme ||
      observed.viewportWidth !== expected.viewportWidth ||
      observed.viewportHeight !== expected.viewportHeight ||
      Math.abs(observed.columnWidth - expected.columnWidth) > 1 ||
      Math.abs(observed.imageRect.width - expected.columnWidth) > 1
    )
      failures.push(`${expected.id}: wrong theme/viewport/column`);
    if (
      !observed.decoded ||
      observed.naturalWidth <= 0 ||
      observed.naturalHeight <= 0 ||
      Math.abs(
        observed.naturalWidth / observed.naturalHeight -
          expected.sourceWidth / expected.sourceHeight,
      ) > 0.01 ||
      observed.alt !== expected.alt
    )
      failures.push(`${expected.id}: decode/dimensions/ALT mismatch`);
    if (
      Math.abs(
        observed.imageRect.height -
          (observed.imageRect.width * expected.sourceHeight) /
            expected.sourceWidth,
      ) > 1
    )
      failures.push(`${expected.id}: displayed image aspect ratio mismatch`);
    if (observed.pageOverflow || observed.imageOverflow)
      failures.push(`${expected.id}: overflow`);
    if (new Set(observed.controls.map((row) => row.state)).size !== 3)
      failures.push(`${expected.id}: missing wrapper state`);
    const title = {
      x:
        observed.imageRect.x +
        expected.titleRegion.x * observed.imageRect.width,
      y:
        observed.imageRect.y +
        expected.titleRegion.y * observed.imageRect.height,
      width: expected.titleRegion.width * observed.imageRect.width,
      height: expected.titleRegion.height * observed.imageRect.height,
    };
    for (const control of observed.controls) {
      if (
        control.state !== "idle" &&
        (!control.visible ||
          !control.opensViewer ||
          (control.state === "keyboard-focus" && !control.focusVisible))
      )
        failures.push(
          `${expected.id}: wrapper control failed ${control.state}`,
        );
      if (
        expected.column === "phone" &&
        control.state === "idle" &&
        !control.visible
      )
        failures.push(`${expected.id}: phone idle expand control hidden`);
      if (control.visible && !control.opensViewer)
        failures.push(
          `${expected.id}: visible expand control does not open viewer`,
        );
      const bounds = control.controlRect;
      if (
        control.visible &&
        (bounds === null ||
          (bounds.x < title.x + title.width &&
            bounds.x + bounds.width > title.x &&
            bounds.y < title.y + title.height &&
            bounds.y + bounds.height > title.y))
      )
        failures.push(
          `${expected.id}: control obscures title ${control.state}`,
        );
      if (
        control.humanLegibility !== "accepted" ||
        control.humanTitle !== "accepted"
      )
        failures.push(
          `${expected.id}: human review incomplete/rejected ${control.state}`,
        );
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return {
    manifestFingerprint: fingerprint,
    packageId: manifest.packageId,
    sourceCommit: manifest.sourceCommit,
    checkedVariants: manifest.cases.length,
  };
}

/** Verify actual screenshot bytes and the immutable package as well as captured observations.
 * @param {string} manifestPath @param {string} observationsPath */
export async function checkImageProof(manifestPath, observationsPath) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const observations = observationSchema.parse(
    JSON.parse(await readFile(observationsPath, "utf8")),
  );
  const pkg = await loadPackage(manifest.packagePath);
  if (pkg.id !== manifest.packageId)
    throw new Error("Image proof package changed");
  const result = validateImageProof(manifest, observations);
  for (const row of observations.cases)
    for (const control of row.controls) {
      const screenshot = resolve(dirname(observationsPath), control.screenshot);
      if ((await fileChecksum(screenshot)) !== control.screenshotSha256)
        throw new Error("Image proof screenshot changed");
    }
  return {
    ...result,
    platformSourceCommit: observations.platformSourceCommit,
    browser: observations.browser,
    reviewer: observations.reviewer,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      package: { type: "string" },
      state: { type: "string" },
      spec: { type: "string" },
      manifest: { type: "string" },
      observations: { type: "string" },
    },
  });
  if (
    positionals[0] === "prepare" &&
    values.package &&
    values.state &&
    values.spec
  ) {
    const result = await prepareImageProof(
      values.package,
      values.state,
      JSON.parse(await readFile(values.spec, "utf8")),
    );
    process.stdout.write(
      `${JSON.stringify({ manifest: result.path, variants: result.manifest.cases.length })}\n`,
    );
  } else if (
    positionals[0] === "check" &&
    values.manifest &&
    values.observations
  ) {
    const result = await checkImageProof(values.manifest, values.observations);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else
    throw new Error(
      "Usage: authoring:image-proof prepare --package PACKAGE_JSON --state STATE_DIRECTORY --spec SPEC_JSON | check --manifest MANIFEST_JSON --observations OBSERVATIONS_JSON",
    );
}
