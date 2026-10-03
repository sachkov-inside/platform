// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { canonical } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { materialApplyRequest } from "./local-boundaries.mjs";
import { applyRelease, previewRelease, releaseTarget } from "./release.mjs";
import { itemAt, reservationBodySchema } from "./test-support.mjs";
import { trustedTarget, trustedTransport } from "./target.mjs";
import { parseEnv } from "../../scripts/identity-proof-bootstrap.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  /** @type {import("./package.mjs").Manifest} */
  const manifest = {
    schemaVersion: 1,
    sourceNamespace: "inside-content",
    selection: {
      guideId: null,
      chapterIds: [],
      materialIds: ["one"],
      complete: true,
    },
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
        showInFeed: true,
        difficulty: null,
        outcomes: [],
        markdown: "Text",
        links: {},
        images: {},
        coverAssetId: null,
        coverAlt: null,
        video: null,
        videoChapters: [],
        artifacts: [],
      },
    ],
    guides: [],
    assets: [],
    diagnostics: [],
  };
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return { manifest, write, packagePath, state: join(directory, "state") };
}

/** @param {"development" | "production"} [mode] The runtime the double reports. */
function api(mode = "development") {
  /** @type {{ materialId: string; contentVersion: number; primaryVideoId: null; cover: null; metadata: { slug: string }; source: unknown }} */
  const material = {
    materialId,
    contentVersion: 1,
    primaryVideoId: null,
    cover: null,
    metadata: { slug: "one" },
    source: null,
  };
  /** @type {string[]} */
  const writes = [];
  /** Receipts by idempotency key, as Platform keeps them. @type {Map<string, unknown>} */
  const receipts = new Map();
  const faults = {
    /** @type {"lost-response" | "expired-session" | undefined} */
    nextApply: undefined,
  };
  return {
    material,
    writes,
    faults,
    /** @type {import("./target.mjs").LocalTransport} */
    async request(path, body, key) {
      if (path.endsWith("/environment")) return { mode };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/collections?kind=guide") return [];
      if (path.endsWith("/validate")) return { valid: true };
      if (path === `/authoring/materials/${materialId}`)
        return structuredClone(material);
      if (path.endsWith("/reserve")) {
        writes.push(path);
        material.source = reservationBodySchema.parse(body).source;
        return structuredClone(material);
      }
      if (path.endsWith("/apply")) {
        if (key !== undefined && receipts.has(key)) return receipts.get(key);
        if (faults.nextApply === "expired-session") {
          faults.nextApply = undefined;
          throw Object.assign(new Error("unauthorized"), { status: 401 });
        }
        writes.push(path);
        const command = materialApplyRequest({ path, body })?.body;
        assert.ok(command);
        assert.equal(command.expectedContentVersion, material.contentVersion);
        Object.assign(material, {
          contentVersion: material.contentVersion + 1,
          source: command.source,
        });
        const receipt = { materialId, contentVersion: material.contentVersion };
        if (key !== undefined) receipts.set(key, receipt);
        if (faults.nextApply === "lost-response") {
          faults.nextApply = undefined;
          throw Object.assign(new Error("connection lost"), { status: 502 });
        }
        return receipt;
      }
      throw new Error(`Unexpected ${path}`);
    },
  };
}

test("preview reads only and apply releases exactly the reviewed package", async (t) => {
  const setup = await fixture(t);
  const server = api();
  const first = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  assert.deepEqual(first.summary, {
    new: 1,
    changed: 0,
    restore: 0,
    unchanged: 0,
    conflict: 0,
  });
  assert.deepEqual(server.writes, []);
  const report = await applyRelease(first.path, setup.state, {
    request: server.request,
  });
  assert.equal(report.applied, 1);
  itemAt(setup.manifest.materials, 0).markdown = "Changed text";
  itemAt(setup.manifest.materials, 0).showInFeed = false;
  await setup.write();
  const second = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  assert.equal(itemAt(second.preview.materials, 0).change, "changed");
  assert.deepEqual(itemAt(second.preview.materials, 0).feedChange, {
    from: true,
    to: false,
  });
});

test("drift after preview, an edited preview and unreviewed archive requests stop before any write", async (t) => {
  const setup = await fixture(t);
  const server = api();
  await syncLocal(setup.packagePath, setup.state, {
    request: server.request,
    publish: "all",
  });
  itemAt(setup.manifest.materials, 0).markdown = "Next";
  await setup.write();
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  const writes = server.writes.length;
  await assert.rejects(
    applyRelease(reviewed.path, setup.state, {
      request: server.request,
      archive: ["other"],
    }),
    /reviewed proposals/u,
  );
  const edited = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(await readFile(reviewed.path, "utf8")));
  edited["archiveProposals"] = ["inside-content:other"];
  await writeFile(reviewed.path, JSON.stringify(edited));
  await assert.rejects(
    applyRelease(reviewed.path, setup.state, { request: server.request }),
    /changed after review/u,
  );
  const fresh = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  server.material.contentVersion += 1;
  await assert.rejects(
    applyRelease(fresh.path, setup.state, { request: server.request }),
    /conflicts|changed after the preview/u,
  );
  assert.equal(server.writes.length, writes);
});

test("only loopback targets and the named trusted target are release targets", () => {
  assert.equal(releaseTarget("stand").id, "http://127.0.0.1:4398");
  const production = releaseTarget("production");
  assert.equal(production.kind, "trusted");
  assert.equal(production.id, "https://inside.sachkov.dev/authoring-api");
  assert.equal(releaseTarget(production.id).kind, "trusted");
  for (const value of [
    "https://sachkov-inside.ru",
    "https://inside.sachkov.dev",
    "http://inside.sachkov.dev/authoring-api",
    "https://inside.sachkov.dev/authoring-api/",
    "http://192.168.1.10:4396",
  ])
    assert.throws(() => releaseTarget(value), /only local loopback targets/u);
});

test("the trusted production target is reached only by an exact reviewed release", async (t) => {
  const setup = await fixture(t);
  const server = api("production");
  const token = async () => "owner-access-token";

  // A direct sync never writes to a trusted target, even with a session.
  await assert.rejects(
    syncLocal(setup.packagePath, setup.state, {
      origin: "production",
      request: server.request,
      accessToken: token,
    }),
    /released only through pnpm authoring:release/u,
  );
  // Without the owner's session there is no transport at all.
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, { origin: "production" }),
    /pnpm authoring:login --target production/u,
  );
  // A local target that answers as production, or production answering as development, is refused.
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      origin: "editor",
      request: server.request,
    }),
    /reports a production runtime; expected development/u,
  );
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      origin: "production",
      request: api("development").request,
      accessToken: token,
    }),
    /reports a development runtime; expected production/u,
  );
  assert.equal(server.writes.length, 0);

  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin: "production",
    request: server.request,
    accessToken: token,
    publish: ["one"],
  });
  assert.equal(
    reviewed.preview.target,
    "https://inside.sachkov.dev/authoring-api",
  );
  assert.equal(reviewed.preview.environment, "production");
  const report = await applyRelease(reviewed.path, setup.state, {
    request: server.request,
    accessToken: token,
  });
  assert.equal(report.applied, 1);
  // The journal belongs to the trusted target, so a local target cannot reuse it.
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      origin: "editor",
      request: api().request,
    }),
    /another environment/u,
  );
  // A repeated release of the same package writes nothing.
  const again = await previewRelease(setup.packagePath, setup.state, {
    origin: "production",
    request: server.request,
    accessToken: token,
    publish: ["one"],
  });
  const writes = server.writes.length;
  const repeated = await applyRelease(again.path, setup.state, {
    request: server.request,
    accessToken: token,
  });
  assert.equal(repeated.applied, 0);
  assert.equal(server.writes.length, writes);
});

test("the trusted transport sends the owner's bearer only to the pinned HTTPS base", async (t) => {
  /** @type {{ url: string; headers: Headers }[]} */
  const seen = [];
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input, init) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ mode: "production" }), {
      status: 200,
    });
  };
  const send = trustedTransport(trustedTarget("production"), async () => "abc");
  await send("/authoring/import/materials/environment", undefined, "key-1");
  assert.equal(
    itemAt(seen, 0).url,
    "https://inside.sachkov.dev/authoring-api/authoring/import/materials/environment",
  );
  assert.equal(itemAt(seen, 0).headers.get("authorization"), "Bearer abc");
  assert.equal(itemAt(seen, 0).headers.get("idempotency-key"), "key-1");
});

test("a lost or unauthorized write is completed once with its key before a new preview", async (t) => {
  for (const fault of /** @type {const} */ ([
    "lost-response",
    "expired-session",
  ]))
    await t.test(fault, async (t) => {
      const setup = await fixture(t);
      const server = api("production");
      const token = async () => "owner-access-token";
      const options = { request: server.request, accessToken: token };
      const reviewed = await previewRelease(setup.packagePath, setup.state, {
        ...options,
        origin: "production",
        publish: ["one"],
      });
      server.faults.nextApply = fault;
      await assert.rejects(applyRelease(reviewed.path, setup.state, options));

      // Repeating apply first completes the unfinished write with its original key.
      await assert.rejects(
        applyRelease(reviewed.path, setup.state, options),
        /changed after the preview/u,
      );
      const applies = server.writes.filter((path) => path.endsWith("/apply"));
      assert.equal(applies.length, 1, fault);

      const fresh = await previewRelease(setup.packagePath, setup.state, {
        ...options,
        origin: "production",
        publish: ["one"],
      });
      const report = await applyRelease(fresh.path, setup.state, options);
      assert.equal(report.applied, 0, fault);
      assert.equal(
        server.writes.filter((path) => path.endsWith("/apply")).length,
        1,
        fault,
      );
    });
});

test("the trusted production target matches the production API configuration", async () => {
  const env = parseEnv(
    await readFile(
      new URL(
        "../../config/compose/production/api.env.example",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const production = trustedTarget("production");
  assert.equal(production.issuer, env["LOGTO_ISSUER"]);
  assert.equal(production.resource, env["LOGTO_AUDIENCE"]);
  assert.equal(production.reader, env["PUBLIC_SITE_ORIGIN"]);
  assert.equal(
    production.id,
    `${String(env["PUBLIC_SITE_ORIGIN"])}/authoring-api`,
  );
});
