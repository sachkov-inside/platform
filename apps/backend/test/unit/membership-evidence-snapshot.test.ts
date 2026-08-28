import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";
import { z } from "zod";

const artifactMetadataSchema = z
  .object({
    sourcePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const snapshotSchema = z
  .object({
    contractVersion: z.literal("inside.membership-evidence.v1"),
    sourceRepository: z.literal("sachkov-inside/workspace"),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    importedAt: z.iso.date(),
    artifacts: z
      .object({
        "schema.json": artifactMetadataSchema,
        "fixtures.json": artifactMetadataSchema,
      })
      .strict(),
    driftCheck: z.string().min(1),
  })
  .strict();

const snapshotRoot = new URL(
  "../../src/modules/membership-entitlements/contracts/inside-membership-evidence-v1/",
  import.meta.url,
);

describe("vendored MembershipEvidence snapshot", () => {
  test("pins provenance and exact artifact digests without a Workspace dependency", async () => {
    const snapshot = snapshotSchema.parse(
      JSON.parse(await readFile(new URL("snapshot.json", snapshotRoot), "utf8")),
    );

    for (const [file, metadata] of Object.entries(snapshot.artifacts)) {
      const contents = await readFile(new URL(file, snapshotRoot));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        metadata.sha256,
      );
      expect(metadata.sourcePath).toMatch(
        /^docs\/contracts\/identity-membership-v1\.(schema|fixtures)\.json$/u,
      );
    }
  });
});
