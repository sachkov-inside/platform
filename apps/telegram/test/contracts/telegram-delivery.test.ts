import { runOwnedCommandSync } from "../support/owned-command.js";

import { describe, expect, it } from "vitest";

const assets = ["compose.yaml", "release-manifest.json", "telegram.caddy"];
const sourceSha = "a".repeat(40);
const legacyReleases = [1, 2, 3, 4, 5].map((ordinal) => ({
  version: `v${ordinal}`,
  immutable: true,
  assets,
  targetCommitish: "1".repeat(40),
}));
const planInput = {
  requestedVersion: "v6",
  sourceSha,
  currentMainSha: sourceSha,
  legacyTags: ["v1", "v2", "v3", "v4", "v5"],
  legacyReleases,
  existingTags: ["v1", "v27", "unrelated"],
  existingReleases: [{ version: "v27", immutable: false, assets: [] }],
};

function plan(input: unknown) {
  return runOwnedCommandSync(
    process.execPath,
    ["scripts/release-contract.mjs", "plan"],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
    },
  );
}

describe("Telegram delivery across the repository transition", () => {
  it("preserves the exact legacy v5 migration identity and 31 files", () => {
    const result = runOwnedCommandSync(
      process.execPath,
      ["scripts/release-contract.mjs", "legacy-migrations-identity"],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      identity:
        "sha256:f91e56479cfcae72f9596dc508c776c5c06e156f16d747e4e91d956931ca533d",
      count: 31,
      latest: "030-invitation-redemptions.ts",
    });
  });

  it("binds the current manifest to the full registry including Mini App migration 031", () => {
    const result = runOwnedCommandSync(
      process.execPath,
      [
        "scripts/release-contract.mjs",
        "manifest",
        "--version",
        "v7",
        "--source-sha",
        sourceSha,
        "--image-digest",
        `sha256:${"d".repeat(64)}`,
        "--compose",
        "infra/production/compose.yaml",
        "--caddy",
        "infra/production/telegram.caddy",
        "--run-id",
        "77",
        "--server-url",
        "https://github.com",
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      migrations: {
        identity:
          "sha256:0f73eb1d14fbd2fab3809223ba469154142bdd81c0479b3a5154c124aa8eb1ae",
        count: 32,
        latest: "031-mini-app-sign-in.ts",
      },
    });
  });

  it("continues legacy v1..v5 as telegram-v6 while ignoring platform vN", () => {
    const result = plan(planInput);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: "v6",
      tag: "telegram-v6",
      sourceSha,
    });
  });
  it.each([
    [
      "stale captured SHA",
      { currentMainSha: "b".repeat(40) },
      /not the current main/,
    ],
    ["duplicate ordinal", { requestedVersion: "v5" }, /next release is v6/],
    ["skipped ordinal", { requestedVersion: "v7" }, /next release is v6/],
    ["bare platform tag", { existingTags: ["telegram-v6"] }, /exactly match/],
    [
      "legacy drift",
      { legacyTags: [...planInput.legacyTags, "v6"] },
      /exactly match/,
    ],
    [
      "legacy gap",
      {
        legacyTags: ["v1", "v3", "v4", "v5"],
        legacyReleases: legacyReleases.filter(
          ({ version }) => version !== "v2",
        ),
      },
      /missing v2/,
    ],
    [
      "mutable legacy release",
      {
        legacyReleases: legacyReleases.map((release) => ({
          ...release,
          immutable: false,
        })),
      },
      /not an immutable release/,
    ],
    [
      "missing legacy asset",
      {
        legacyReleases: legacyReleases.map((release) => ({
          ...release,
          assets: ["compose.yaml"],
        })),
      },
      /exactly the Telegram release assets/,
    ],
    [
      "stale target reference",
      {
        legacyReleases: legacyReleases.map((release) => ({
          ...release,
          targetCommitish: "main",
        })),
      },
      /target must be a full commit SHA/,
    ],
    [
      "platform history gap",
      {
        existingTags: ["telegram-v7"],
        existingReleases: [
          {
            version: "telegram-v7",
            immutable: true,
            assets,
            targetCommitish: sourceSha,
          },
        ],
      },
      /missing v6/,
    ],
    [
      "overlapping platform ordinal",
      {
        existingTags: ["telegram-v5"],
        existingReleases: [
          {
            version: "telegram-v5",
            immutable: true,
            assets,
            targetCommitish: sourceSha,
          },
        ],
      },
      /must start at telegram-v6/,
    ],
    [
      "mutable platform release",
      {
        existingTags: ["telegram-v6"],
        existingReleases: [
          {
            version: "telegram-v6",
            immutable: false,
            assets,
            targetCommitish: sourceSha,
          },
        ],
      },
      /not an immutable release/,
    ],
  ])("refuses %s", (_name, override, message) => {
    const result = plan({ ...planInput, ...override });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
  });

  it("continues both verified histories with telegram-v7", () => {
    const result = plan({
      ...planInput,
      requestedVersion: "v7",
      existingTags: ["telegram-v6", "v88"],
      existingReleases: [
        {
          version: "telegram-v6",
          immutable: true,
          assets,
          targetCommitish: sourceSha,
        },
      ],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: "v7",
      tag: "telegram-v7",
      sourceSha,
    });
  });
});
