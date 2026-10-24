import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { buildFixtures } from "../fixtures.mjs";
import { packageDependencies } from "./package-adapter.mjs";
import { anonymousSubject } from "../../../apps/backend/src/modules/content-access/index.js";

await test("the native review matrix reads complete pinned Task context and full Material while the old Practice port refuses", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "task-native-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtures = await buildFixtures(root);
  const dependencies = await packageDependencies(fixtures.packagePath);
  const first = await dependencies.tasks.read({
    subject: anonymousSubject,
    code: "review-brief",
  });
  if (!first.ok) throw new Error(first.error.code);
  let serialized = first.value.data;
  assert.ok(first.value.partCount > 1);
  for (let part = 1; part < first.value.partCount; part++) {
    const current = await dependencies.tasks.read({
      subject: anonymousSubject,
      code: "review-brief",
      expectedContextVersion: first.value.contextVersion,
      expectedContentSha256: first.value.contentSha256,
      part,
    });
    if (!current.ok) throw new Error(current.error.code);
    serialized += current.value.data;
  }
  assert.equal(
    createHash("sha256").update(serialized).digest("hex"),
    first.value.contentSha256,
  );
  const context = z
    .object({
      terminalMarker: z.string(),
      payload: z.object({
        task: z.object({
          code: z.string(),
          definition: z.object({
            result: z.array(z.string()),
            criteria: z.array(z.object({ id: z.string() })),
          }),
        }),
        practice: z.object({
          complete: z.literal(true),
          contentVersion: z.number(),
          body: z.json(),
        }),
      }),
    })
    .parse(JSON.parse(serialized));
  assert.equal(context.payload.task.code, "review-brief");
  assert.ok(context.payload.task.definition.criteria.length > 0);
  assert.ok(
    JSON.stringify(context.payload.practice.body).includes(
      "Контрольный смысл конца урока",
    ),
  );
  assert.equal(
    context.terminalMarker,
    `END_CONTEXT:${first.value.contextVersion}`,
  );
  assert.equal(
    (
      await dependencies.reader.readPractice({
        subject: anonymousSubject,
        practiceId: "synthetic:brief",
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await dependencies.tasks.read({
        subject: anonymousSubject,
        code: "review-brief",
        expectedContextVersion: "0".repeat(64),
      })
    ).ok,
    false,
  );
});
