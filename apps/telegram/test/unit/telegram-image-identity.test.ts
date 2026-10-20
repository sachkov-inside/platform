import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadTelegramImageIdentity } from "../../src/observability/image-identity.js";

it("uses only a bounded shared-schema image identity and quietly disables telemetry when absent or invalid", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "telegram-read-image-identity-"),
  );
  const identity = join(directory, "release-identity.json");
  try {
    expect(loadTelegramImageIdentity(identity)).toBeUndefined();
    await writeFile(
      identity,
      '{"release":"v42","sourceSha":"1234567890abcdef1234567890abcdef12345678"}\n',
    );
    expect(loadTelegramImageIdentity(identity)).toEqual({
      release: "v42",
      sourceSha: "1234567890abcdef1234567890abcdef12345678",
    });
    for (const invalid of [
      "{}",
      "null",
      "not json",
      " ".repeat(513),
      '{"release":"development","sourceSha":"1234567890abcdef1234567890abcdef12345678"}',
    ]) {
      await writeFile(identity, invalid);
      expect(loadTelegramImageIdentity(identity)).toBeUndefined();
    }
    expect(loadTelegramImageIdentity(directory)).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
