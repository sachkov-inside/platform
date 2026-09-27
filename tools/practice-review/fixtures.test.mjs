// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createHash } from "node:crypto";
import { buildFixtures, repairFeature } from "./fixtures.mjs";
import { convertMarkdown } from "../authoring/markdown.mjs";
import { renderMaterialBlocks } from "@inside/material-blocks";
import { loadPackage } from "../authoring/package.mjs";

const observationSchema = z.object({
  storedCount: z.number(),
  source: z.record(z.string(), z.string()),
  observations: z.object({
    create: z.object({
      response: z.object({ body: z.object({ id: z.string() }) }),
    }),
    repeat: z.object({
      response: z.object({ body: z.object({ id: z.string() }) }),
    }),
  }),
});

test("full synthetic package, real behavior, stale binding and external repair are independently observable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "practice-fixtures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await buildFixtures(root);
  const pkg = await loadPackage(f.packagePath);
  assert.equal(pkg.manifest.practiceDefinitions?.length, 3);
  for (const lesson of pkg.manifest.materials) {
    assert.ok(lesson.markdown.length > 2000);
    const document = convertMarkdown(lesson.markdown, {
      sourceId: lesson.sourceId,
      sourcePath: lesson.sourcePath,
      link: (href) => href,
      image: (href) => href,
    });
    const rendered = renderMaterialBlocks(
      z.array(z.json()).parse(document.doc.content),
    );
    assert.ok(rendered.length > 5);
    assert.ok(
      JSON.stringify(rendered).includes("Контрольный смысл конца урока"),
    );
  }
  for (const item of f.cases)
    assert.match(item.projectDir, /project-[a-f0-9-]+$/u);
  const feature = f.cases.find((item) => item.id === "feature-recheck");
  assert.ok(feature);
  const before = observationSchema.parse(
    JSON.parse(
      await readFile(join(feature.projectDir, "observations.json"), "utf8"),
    ),
  );
  assert.equal(before.storedCount, 2);
  assert.notEqual(
    before.observations.create.response.body["id"],
    before.observations.repeat.response.body["id"],
  );
  const after = await repairFeature(feature.projectDir);
  assert.equal(after.storedCount, 1);
  assert.equal(
    after.observations.create.response.body["id"],
    after.observations.repeat.response.body["id"],
  );
  assert.equal(after.observations.other.response.status, 404);
  assert.deepEqual(after.observations.other.response.body, {
    error: "unavailable",
  });
  const stale = f.cases.find((item) => item.id === "feature-stale");
  assert.ok(stale);
  const observed = observationSchema.parse(
    JSON.parse(
      await readFile(join(stale.projectDir, "observations.json"), "utf8"),
    ),
  );
  const actual = createHash("sha256")
    .update(await readFile(join(stale.projectDir, "app.mjs")))
    .digest("hex");
  assert.notEqual(observed.source["app.mjs"], actual);
});
