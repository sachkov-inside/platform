// @ts-check
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { runDelivery } from "./deliver.mjs";
import { pinnedNode } from "./delivery-environment.mjs";
import { materialApplyRequest, parseJournal } from "./local-boundaries.mjs";
import { canonical, supportedPackageFeatures } from "./package.mjs";
import { previewRelease } from "./release.mjs";
import { authoringTarget } from "./target.mjs";

const execute = promisify(execFile);
const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** A Content repository with two commits, so history has a direction. */
async function contentRepository(/** @type {string} */ directory) {
  const git = (/** @type {string[]} */ ...args) =>
    execute("git", ["-C", directory, ...args]).then(({ stdout }) =>
      stdout.trim(),
    );
  await execute("git", ["init", "-q", directory]);
  await git("config", "user.email", "content@example.invalid");
  await git("config", "user.name", "Content");
  await writeFile(join(directory, "one.md"), "first\n");
  await git("add", "one.md");
  await git("commit", "-q", "-m", "first");
  const older = await git("rev-parse", "HEAD");
  await writeFile(join(directory, "one.md"), "second\n");
  await git("commit", "-q", "-am", "second");
  const newer = await git("rev-parse", "HEAD");
  return { older, newer };
}

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "deliver-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = join(directory, "content");
  const commits = await contentRepository(repository);
  /** @type {import('./package.mjs').Manifest["materials"][number]} */
  const material = {
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
    // Content's own access is replaced by the target's: preservation keeps "closed".
    access: "free",
    showInFeed: false,
    difficulty: null,
    outcomes: [],
    markdown: "Changed text with [context](two.md)",
    links: { "two.md": "two" },
    images: {},
    coverAssetId: null,
    coverAlt: null,
    video: null,
    videoChapters: [],
    artifacts: [],
  };
  /** @type {import('./package.mjs').Manifest} */
  const manifest = {
    schemaVersion: 2,
    requiredFeatures: ["bounded-content-v1"],
    sourceNamespace: "synthetic",
    selection: {
      productId: "course",
      chapterIds: [],
      materialIds: ["one", "two"],
      taskIds: [],
      contentOnly: { materialIds: ["one"], taskIds: [], artifactIds: [] },
      complete: true,
    },
    products: [],
    assets: [],
    diagnostics: [],
    materials: [
      material,
      {
        ...material,
        sourceId: "two",
        sourcePath: "two.md",
        markdown: "Context",
        links: {},
      },
    ],
  };
  const packagePath = join(directory, "package.json");
  await writeFile(packagePath, canonical(manifest));
  const model = {
    materialId,
    contentVersion: 4,
    publicationState: /** @type {"draft" | "published"} */ ("published"),
    access: "closed",
    source: {
      id: "synthetic:one",
      path: "one.md",
      revision: "b".repeat(64),
      showInFeed: false,
      commit: /** @type {string | null} */ (null),
    },
  };
  /** @type {{ path: string; body: unknown }[]} */
  const requests = [];
  /** @type {Map<string, unknown>} */
  const receipts = new Map();
  const network = { loseNextApplyAnswer: false };
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body, key) => {
    requests.push({ path, body });
    if (path === "/authoring/import/materials/environment")
      return {
        mode: "production",
        contract: {
          version: 1,
          packageFeatures: [...supportedPackageFeatures],
        },
      };
    if (path === "/authoring/import/materials/state?namespace=synthetic")
      return {
        namespace: "synthetic",
        materials: [
          {
            sourceId: "synthetic:one",
            materialId,
            slug: "one-slug",
            contentVersion: model.contentVersion,
            access: model.access,
            publicationState: model.publicationState,
            source: {
              path: model.source.path,
              revision: model.source.revision,
              commit: model.source.commit,
              showInFeed: model.source.showInFeed,
            },
            memberships: [],
          },
          {
            sourceId: "synthetic:two",
            materialId: otherId,
            slug: "two-on-target",
            contentVersion: 2,
            access: "free",
            publicationState: "published",
            source: {
              path: "two.md",
              revision: "c".repeat(64),
              commit: null,
              showInFeed: true,
            },
            memberships: [],
          },
        ],
      };
    if (path === "/authoring/import/tasks/state?namespace=synthetic")
      return { namespace: "synthetic", tasks: [] };
    if (path.startsWith("/authoring/collections?kind=")) return [];
    if (path === "/authoring/import/materials/validate") return { valid: true };
    if (path === `/authoring/materials/${materialId}`)
      return {
        materialId,
        contentVersion: model.contentVersion,
        publicationState: model.publicationState,
        primaryVideoId: null,
        cover: null,
        metadata: {
          slug: "one-slug",
          access: model.access,
          seriesMemberships: [],
        },
        source: structuredClone(model.source),
      };
    if (path === "/authoring/import/materials/apply") {
      // The receiver answers a repeated key with its first receipt and writes nothing.
      if (key !== undefined && receipts.has(key)) return receipts.get(key);
      const command = materialApplyRequest({ path, body })?.body;
      assert.ok(command);
      assert.equal(command.expectedContentVersion, model.contentVersion);
      model.contentVersion += 1;
      model.access = command.metadata.access;
      model.source = {
        id: command.source.id,
        path: command.source.path,
        revision: command.source.revision,
        showInFeed: command.source.showInFeed,
        commit: z(command.source["commit"]),
      };
      const receipt = { materialId, contentVersion: model.contentVersion };
      if (key !== undefined) receipts.set(key, receipt);
      if (network.loseNextApplyAnswer) {
        network.loseNextApplyAnswer = false;
        throw new TypeError("fetch failed");
      }
      return receipt;
    }
    throw new Error(`Unexpected ${path}`);
  };
  /** @type {import('./deliver.mjs').Connect} */
  const connect = async (targetName, work) =>
    work({
      target: authoringTarget(targetName),
      send: request,
      accessToken: undefined,
      connection: { synthetic: true },
    });
  const state = join(directory, "state");
  /** Exports by ref: each test decides what Content history holds. */
  const exports = {
    /** @type {Record<string, string>} */
    packages: {},
    head: commits.newer,
  };
  /** @type {import('./source-commit.mjs').ExportPackage} */
  const exportPackage = async (_repository, guide, _state, ref) => {
    assert.equal(guide, "course");
    const commit = ref === "HEAD" ? exports.head : ref;
    return { commit, packagePath: exports.packages[commit] ?? packagePath };
  };
  const run = (/** @type {string[]} */ ...argv) =>
    runDelivery(argv, { connect, nodeVersion: pinnedNode(), exportPackage });
  return {
    directory,
    repository,
    commits,
    packagePath,
    state,
    manifest,
    model,
    request,
    requests,
    run,
    exports,
    network,
  };
}

/** @param {unknown} value */
const z = (value) => (typeof value === "string" ? value : null);

/**
 * A value inside a JSON document, or undefined.
 *
 * @param {unknown} value
 * @param {...(string | number)} path
 * @returns {unknown}
 */
const at = (value, ...path) =>
  path.reduce(
    (current, key) =>
      current !== null && typeof current === "object"
        ? Reflect.get(current, key)
        : undefined,
    value,
  );

test("production content-only delivery: reconcile, preview, apply, verification and commit guard", async (t) => {
  const f = await fixture(t);
  const preview = (/** @type {string} */ commit) =>
    f.run(
      "preview",
      "--target",
      "production",
      "--package",
      f.packagePath,
      "--commit",
      commit,
      "--content-repository",
      f.repository,
      "--state",
      f.state,
      "--material",
      "one",
    );

  const missing = await preview(f.commits.newer);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.document["ok"], false);
  assert.match(JSON.stringify(missing.document), /"code":"journal_missing"/u);

  const reconcile = await f.run(
    "reconcile",
    "--target",
    "production",
    "--state",
    f.state,
    "--namespace",
    "synthetic",
  );
  assert.equal(reconcile.exitCode, 0);
  assert.deepEqual(at(reconcile.document, "counts"), {
    agree: 0,
    journal_only: 0,
    target_only: 2,
    identity_differs: 0,
    version_differs: 0,
  });
  const adoptedContext = await f.run(
    "reconcile",
    "--target",
    "production",
    "--state",
    f.state,
    "--namespace",
    "synthetic",
    "--adopt",
    "two",
  );
  assert.equal(adoptedContext.exitCode, 0);
  const journalPath = join(f.state, "journal.json");
  const journal = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  const context = journal.materials["synthetic:two"];
  assert.ok(context);
  context.url = "/materials/stale-journal-path";
  await writeFile(journalPath, canonical(journal));
  const unknown = await preview(f.commits.newer);
  assert.match(
    JSON.stringify(unknown.document),
    /"code":"journal_identity_missing"/u,
  );
  const adopted = await f.run(
    "reconcile",
    "--target",
    "production",
    "--state",
    f.state,
    "--namespace",
    "synthetic",
    "--adopt",
    "one",
  );
  assert.deepEqual(at(adopted.document, "adopted"), ["synthetic:one"]);
  assert.equal(
    f.requests.some((row) => row.path === "/authoring/import/materials/apply"),
    false,
    "reconciliation writes nothing to the target",
  );

  const reviewed = await preview(f.commits.newer);
  assert.equal(reviewed.exitCode, 0, JSON.stringify(reviewed.document));
  const document = reviewed.document;
  assert.equal(at(document, "receiver", "environment"), "production");
  assert.equal(at(document, "receiver", "contract", "version"), 1);
  assert.equal(at(document, "hasChanges"), true);
  assert.equal(at(document, "rows", "length"), 1);
  assert.deepEqual(
    ["kind", "sourceId", "change", "access", "publicationState"].map((key) =>
      at(document, "rows", 0, key),
    ),
    ["material", "one", "changed", "closed", "published"],
  );
  assert.equal(
    at(document, "rows", 0, "sourceCommit", "relation"),
    "unrecorded",
  );
  assert.equal(f.model.contentVersion, 4, "preview writes nothing");

  const applied = await f.run(
    "apply",
    "--receipt",
    String(at(document, "receipt")),
    "--state",
    f.state,
  );
  assert.equal(applied.exitCode, 0, JSON.stringify(applied.document));
  const result = applied.document;
  assert.equal(at(result, "verification", "unchanged"), true);
  assert.deepEqual(at(result, "rows", 0, "contentVersion"), {
    before: 4,
    after: 5,
  });
  assert.deepEqual(at(result, "rows", 0, "sourceCommit"), {
    before: null,
    after: f.commits.newer,
  });
  assert.equal(f.model.access, "closed");
  assert.equal(f.model.publicationState, "published");
  const writes = f.requests.filter(
    (row) => row.path === "/authoring/import/materials/apply",
  );
  assert.equal(writes.length, 1);
  // The unselected context Material links to the target's own Reader path, unknown to the journal.
  assert.match(JSON.stringify(writes[0]?.body), /\/materials\/two-on-target/u);
  assert.doesNotMatch(JSON.stringify(writes[0]?.body), /stale-journal-path/u);
  /** @type {unknown} */
  const proof = JSON.parse(await readFile(String(at(result, "proof")), "utf8"));
  assert.equal(at(proof, "verification", "unchanged"), true);

  const older = await preview(f.commits.older);
  assert.equal(older.exitCode, 1);
  assert.match(JSON.stringify(older.document), /"code":"source_commit_older"/u);
  const same = await preview(f.commits.newer);
  assert.equal(same.exitCode, 0, JSON.stringify(same.document));
  assert.equal(at(same.document, "hasChanges"), false);
  assert.equal(
    at(same.document, "rows", 0, "sourceCommit", "relation"),
    "same",
  );

  // The full release meets the same history: without a commit, or with an older one, it conflicts.
  const manifest = structuredClone(f.manifest);
  delete manifest.selection.contentOnly;
  manifest.requiredFeatures = [];
  manifest.selection.materialIds = ["one"];
  const [first] = manifest.materials;
  assert.ok(first);
  manifest.materials = [{ ...first, markdown: "Full text", links: {} }];
  const fullPackage = join(f.directory, "full.json");
  await writeFile(fullPackage, canonical(manifest));
  /** @param {{ sourceCommit?: string; contentRepository?: string }} options */
  const full = async (options) =>
    (
      await previewRelease(fullPackage, f.state, {
        origin: "production",
        request: f.request,
        publish: ["one"],
        ...options,
      })
    ).preview.materials[0];
  assert.equal((await full({}))?.["conflictReason"], "source_commit_unknown");
  assert.equal(
    (
      await full({
        sourceCommit: f.commits.older,
        contentRepository: f.repository,
      })
    )?.["conflictReason"],
    "source_commit_older",
  );
  const current = await full({
    sourceCommit: f.commits.newer,
    contentRepository: f.repository,
  });
  assert.notEqual(current?.change, "conflict");
  assert.deepEqual(current?.["sourceCommit"], {
    current: f.commits.newer,
    desired: f.commits.newer,
  });
});

test("delivery refuses before any request: Node, usage, selection and unbounded packages", async (t) => {
  const f = await fixture(t);
  const node = await runDelivery(["apply", "--receipt", "x", "--state", "y"], {
    nodeVersion: "24.19.0",
  });
  assert.equal(node.exitCode, 1);
  assert.match(
    JSON.stringify(node.document),
    /"code":"node_version".*Node 26/u,
  );
  const usage = await f.run("preview", "--target", "production");
  assert.equal(usage.exitCode, 2);
  const unknownFlag = await f.run(
    "apply",
    "--receipt",
    "x",
    "--state",
    "y",
    "--publish",
    "one",
  );
  assert.equal(unknownFlag.exitCode, 2);
  const mismatch = await f.run(
    "preview",
    "--target",
    "production",
    "--package",
    f.packagePath,
    "--commit",
    f.commits.newer,
    "--content-repository",
    f.repository,
    "--state",
    f.state,
    "--material",
    "two",
  );
  assert.match(
    JSON.stringify(mismatch.document),
    /"code":"selection_mismatch"/u,
  );
  const editor = await f.run(
    "preview",
    "--target",
    "editor",
    "--package",
    f.packagePath,
    "--commit",
    f.commits.newer,
    "--content-repository",
    f.repository,
    "--state",
    f.state,
    "--material",
    "one",
  );
  assert.match(JSON.stringify(editor.document), /"code":"target_unsupported"/u);
  const manifest = structuredClone(f.manifest);
  delete manifest.selection.contentOnly;
  manifest.requiredFeatures = [];
  await writeFile(f.packagePath, canonical(manifest));
  const unbounded = await f.run(
    "preview",
    "--target",
    "production",
    "--package",
    f.packagePath,
    "--commit",
    f.commits.newer,
    "--content-repository",
    f.repository,
    "--state",
    f.state,
    "--material",
    "one",
  );
  assert.match(
    JSON.stringify(unbounded.document),
    /"code":"package_not_bounded"/u,
  );
  assert.deepEqual(f.requests, []);
});

test("the package must be the export of its commit and the newest content of each selected row", async (t) => {
  const f = await fixture(t);
  const preview = (/** @type {string} */ commit) =>
    f.run(
      "preview",
      "--target",
      "production",
      "--package",
      f.packagePath,
      "--commit",
      commit,
      "--content-repository",
      f.repository,
      "--state",
      f.state,
      "--material",
      "one",
    );
  // An older prepared package named with the current commit: the export of that commit differs.
  const current = structuredClone(f.manifest);
  const [first] = current.materials;
  assert.ok(first);
  first.markdown = "Newer text in Content";
  const currentPath = join(f.directory, "current.json");
  await writeFile(currentPath, canonical(current));
  f.exports.packages[f.commits.newer] = currentPath;
  const mismatch = await preview(f.commits.newer);
  assert.equal(
    at(mismatch.document, "error", "code"),
    "package_commit_mismatch",
  );
  assert.match(
    String(at(mismatch.document, "error", "message")),
    /material:one/u,
  );
  // The package is its commit, but HEAD already changed the same Material.
  f.exports.packages[f.commits.older] = f.packagePath;
  const newer = await preview(f.commits.older);
  assert.equal(
    at(newer.document, "error", "code"),
    "source_newer_in_repository",
  );
  // Unrelated later commits do not block: the selected row is unchanged at HEAD.
  f.exports.packages[f.commits.newer] = f.packagePath;
  const unrelated = await preview(f.commits.older);
  assert.equal(at(unrelated.document, "error", "code"), "journal_missing");
  assert.deepEqual(
    f.requests.filter((row) => row.path.includes("/apply")),
    [],
  );
});

test("a lost apply answer is completed once by repeating apply, then a new preview sees it", async (t) => {
  const f = await fixture(t);
  const args = [
    "--target",
    "production",
    "--package",
    f.packagePath,
    "--commit",
    f.commits.newer,
    "--content-repository",
    f.repository,
    "--state",
    f.state,
    "--material",
    "one",
  ];
  await f.run(
    "reconcile",
    "--target",
    "production",
    "--state",
    f.state,
    "--namespace",
    "synthetic",
    "--adopt",
    "one",
    "--adopt",
    "two",
  );
  const reviewed = await f.run("preview", ...args);
  assert.equal(reviewed.exitCode, 0, JSON.stringify(reviewed.document));
  const receipt = String(at(reviewed.document, "receipt"));
  f.network.loseNextApplyAnswer = true;
  const lost = await f.run("apply", "--receipt", receipt, "--state", f.state);
  assert.equal(lost.exitCode, 1);
  assert.equal(f.model.contentVersion, 5, "the receiver applied the write");
  const blocked = await f.run("preview", ...args);
  assert.equal(at(blocked.document, "error", "code"), "journal_pending");
  const completed = await f.run(
    "apply",
    "--receipt",
    receipt,
    "--state",
    f.state,
  );
  assert.equal(at(completed.document, "error", "code"), "journal_completed");
  assert.equal(f.model.contentVersion, 5, "the repeated key wrote nothing new");
  const after = await f.run("preview", ...args);
  assert.equal(after.exitCode, 0, JSON.stringify(after.document));
  assert.equal(at(after.document, "hasChanges"), false);
});
