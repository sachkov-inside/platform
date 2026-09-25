import { describe, expect, test } from "vitest";

import { commandFingerprint } from "../../src/modules/billing/shared/command-fingerprint.js";
import { fingerprintCommand } from "../../src/modules/materials/shared/canonical-command-fingerprint.js";

describe("MaterialAuthoring command fingerprint", () => {
  test("fingerprints a canonical, versioned request envelope", () => {
    expect(fingerprintCommand({ operation: "revise_draft", changes: {} })).toBe(
      "86e65b719b29a3f3c8f2ee0d79820728bd97e566f889110bc88d17159558b4ab",
    );
    expect(
      fingerprintCommand({ changes: {}, operation: "revise_draft" }),
    ).toBe(fingerprintCommand({ operation: "revise_draft", changes: {} }));
  });

  // Stored receipts hold these digests: Materials and Billing share one canonical form, and its
  // output for mixed-case keys, absent fields and holes in arrays stays byte-for-byte the same.
  test("keeps the stored digests of both command envelopes", () => {
    const command = {
      zeta: 1,
      coverUrl: "a",
      covers: [{ b: undefined, a: "x", Ä: 2 }],
      alpha: undefined,
      nested: { B: 1, a: [3, undefined, null] },
    };
    expect(fingerprintCommand(command)).toBe(
      "e7db6cfc09d5d273ac687bc1b61455316ea5b375a8bbc7e9a66ea41850792933",
    );
    expect(commandFingerprint("save", command)).toBe(
      "e9f9fa1031c5e03129da7b3c89af52d6d0297c11b006838a6610270f7ba9c3d4",
    );
  });
});
