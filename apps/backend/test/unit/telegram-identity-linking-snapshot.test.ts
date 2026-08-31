import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";
import { z } from "zod";

const artifactSchema = z
  .object({
    sourcePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const snapshotSchema = z
  .object({
    contractVersion: z.literal("inside.identity-linking.v1"),
    sourceRepository: z.literal("sachkov-inside/inside-telegram"),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    importedAt: z.iso.date(),
    artifacts: z
      .object({
        "fixtures.json": artifactSchema,
        "schema.json": artifactSchema,
      })
      .strict(),
    driftCheck: z.string().min(1),
  })
  .strict();
const fixturesSchema = z
  .object({
    fixtureVersion: z.literal("inside.identity-linking-fixtures.v1"),
    messages: z.array(
      z.object({
        name: z.string().min(1),
        expectedValid: z.boolean(),
        envelope: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .loose();
const contractRoot = new URL(
  "../../src/modules/telegram-membership/contracts/inside-identity-linking-v1/",
  import.meta.url,
);

describe("vendored Telegram identity-linking contract", () => {
  test("pins the provider-owned v1 artifacts and required Platform messages", async () => {
    const snapshot = snapshotSchema.parse(
      JSON.parse(await readFile(new URL("snapshot.json", contractRoot), "utf8")),
    );
    for (const [file, metadata] of Object.entries(snapshot.artifacts)) {
      const contents = await readFile(new URL(file, contractRoot));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        metadata.sha256,
      );
    }
    const fixtures = fixturesSchema.parse(
      JSON.parse(await readFile(new URL("fixtures.json", contractRoot), "utf8")),
    );
    expect(fixtures.messages.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "begin-link",
        "link-challenge",
        "confirmation",
        "linked",
        "recovery-required",
        "raw-token-is-forbidden",
        "unknown-field",
      ]),
    );
  });
});
