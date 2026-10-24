import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runOwnedCommandSync } from "../support/owned-command.js";

const writer = new URL(
  "../../scripts/write-image-identity.mjs",
  import.meta.url,
);

// Real Node CLI boundary, 2000ms failure budget, owned supervisor awaits full process cleanup.
function executeWriter(args: readonly string[]) {
  return runOwnedCommandSync(process.execPath, [writer.pathname, ...args], {
    encoding: "utf8",
    timeout: 2000,
    env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" },
  });
}

it("seals the captured release ordinal and commit without inventing an identity for local builds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-image-identity-"));
  const identity = join(directory, "release-identity.json");
  const sourceSha = "1234567890abcdef1234567890abcdef12345678";
  try {
    expect(executeWriter(["", sourceSha, identity]).status).toBe(0);
    expect(await readdir(directory)).toEqual([]);
    expect(executeWriter(["v42", sourceSha, identity]).status).toBe(0);
    expect(await readFile(identity, "utf8")).toBe(
      '{"release":"v42","sourceSha":"1234567890abcdef1234567890abcdef12345678"}\n',
    );
    expect((await stat(identity)).mode & 0o777).toBe(0o444);
    expect(executeWriter(["v43", sourceSha, identity]).status).toBe(1);
    expect(JSON.parse(await readFile(identity, "utf8"))).toEqual({
      release: "v42",
      sourceSha,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  ["v0", "1234567890abcdef1234567890abcdef12345678"],
  ["v01", "1234567890abcdef1234567890abcdef12345678"],
  ["v9007199254740992", "1234567890abcdef1234567890abcdef12345678"],
  ["v42", "1234567890ABCDEF1234567890ABCDEF12345678"],
  ["v42", ""],
])(
  "rejects invalid captured release metadata %s before writing",
  async (release, sourceSha) => {
    const directory = await mkdtemp(
      join(tmpdir(), "telegram-invalid-identity-"),
    );
    try {
      expect(
        executeWriter([
          release,
          sourceSha,
          join(directory, "release-identity.json"),
        ]).status,
      ).toBe(1);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
