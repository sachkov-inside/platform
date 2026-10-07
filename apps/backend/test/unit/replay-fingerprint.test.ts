import { describe, expect, test } from "vitest";

import { replayCommandFingerprint } from "../../src/modules/billing/shared/command-fingerprint.js";
import { accessFingerprint } from "../../src/modules/account-rights/shared/access-receipts.js";

// Receipts stored before #732 hold digests of JSON.stringify output, which follows key order. The
// literals below were taken from that form; they must keep matching the same command.
describe("Replay fingerprints moved to commandDigest", () => {
  const operationId = "b7c1f0e2-0000-4000-8000-000000000001";
  const accountId = "b7c1f0e2-0000-4000-8000-000000000002";

  test("an access fingerprint ignores key order and recognizes its stored unsorted form", () => {
    const fingerprint = accessFingerprint({
      action: "assignEnrollment",
      command: { operationId, accountId, tierId: "tier" },
    });
    expect(fingerprint.digest).toBe(
      accessFingerprint({
        command: { tierId: "tier", accountId, operationId },
        action: "assignEnrollment",
      }).digest,
    );
    expect(fingerprint.digest).not.toBe(
      accessFingerprint({
        action: "assignEnrollment",
        command: { operationId, accountId, tierId: "other" },
      }).digest,
    );
    expect(fingerprint.recognizes(fingerprint.digest)).toBe(true);
    expect(
      fingerprint.recognizes(
        "8c6cc4ffbbe4b981ff1919f18d546934953f24b92fb55434f56e7ae48b5c78e2",
      ),
    ).toBe(true);
    expect(fingerprint.digest).not.toBe(
      "8c6cc4ffbbe4b981ff1919f18d546934953f24b92fb55434f56e7ae48b5c78e2",
    );
    expect(
      accessFingerprint({
        action: "assignEnrollment",
        command: { operationId, accountId, tierId: "other" },
      }).recognizes(
        "8c6cc4ffbbe4b981ff1919f18d546934953f24b92fb55434f56e7ae48b5c78e2",
      ),
    ).toBe(false);
  });

  test("a billing command fingerprint ignores key order and recognizes its stored JSON text", () => {
    const command = {
      operation: "offers.save",
      operationId,
      expectedRevision: 0,
    };
    const fingerprint = replayCommandFingerprint("manageCatalog", command);
    expect(fingerprint.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprint.digest).toBe(
      replayCommandFingerprint("manageCatalog", {
        expectedRevision: 0,
        operationId,
        operation: "offers.save",
      }).digest,
    );
    expect(
      fingerprint.recognizes(
        `{"operation":"offers.save","operationId":"${operationId}","expectedRevision":0}`,
      ),
    ).toBe(true);
    expect(
      replayCommandFingerprint("manageCatalog", {
        ...command,
        expectedRevision: 1,
      }).recognizes(
        `{"operation":"offers.save","operationId":"${operationId}","expectedRevision":0}`,
      ),
    ).toBe(false);
    expect(replayCommandFingerprint("purchase", command).digest).not.toBe(
      fingerprint.digest,
    );
  });
});

// These literals use the independently reconstructed pre-0082 envelopes, including v1 receipts.
describe("Receipts across the Product vocabulary upgrade", () => {
  const productId = "b7c1f0e2-0000-4000-8000-000000000003";
  const coverage = {
    productIds: [productId],
    materialIds: [],
    wholePlatform: true,
  };
  test("recognizes both manual receipt generations and preserves conflict detection", () => {
    const command = {
      operationId: "b7c1f0e2-0000-4000-8000-000000000001",
      terms: {
        capabilities: ["materials", `product:${productId}`],
        coverage,
        reason: "guide: literal",
      },
    };
    const fingerprint = accessFingerprint(command);
    expect(fingerprint.digest).toBe(
      "874d8509e374abfc48229c3f0540e0d76e6577f98ded312f37fe2c42b2a506cb",
    );
    expect(
      fingerprint.recognizes(
        "9ef3419f510e52328d958050af677dda73dc2f76af94f9c9992c121e00555ad5",
      ),
    ).toBe(true);
    expect(
      accessFingerprint({
        ...command,
        terms: { ...command.terms, reason: "Changed reason" },
      }).recognizes(fingerprint.digest),
    ).toBe(false);
  });
  test("recognizes a catalog command whose sorted capabilities changed position", () => {
    const command = {
      operation: "offers.save",
      benefits: ["materials", `product:${productId}`],
      coverage,
      name: "product: literal",
    };
    const fingerprint = replayCommandFingerprint("manageCatalog", command);
    expect(fingerprint.digest).toBe(
      "adbe42b41ba3d6c9ec649c1a628d92126507241e7dcba0f6960d7e99515eeda3",
    );
    expect(
      replayCommandFingerprint("manageCatalog", {
        ...command,
        coverage: { ...coverage, productIds: [] },
      }).recognizes(fingerprint.digest),
    ).toBe(false);
  });
});
