import { describe, expect, test } from "vitest";

import { commandFingerprint } from "../../src/modules/billing/shared/command-fingerprint.js";
import { tributeFingerprint } from "../../src/modules/account-rights/domain/tribute-webhook.js";
import { fingerprintCommand } from "../../src/modules/materials/shared/canonical-command-fingerprint.js";

describe("Command fingerprints", () => {
  test("fingerprints a canonical, versioned request envelope", () => {
    expect(fingerprintCommand({ operation: "revise_draft", changes: {} })).toBe(
      "86e65b719b29a3f3c8f2ee0d79820728bd97e566f889110bc88d17159558b4ab",
    );
    expect(fingerprintCommand({ changes: {}, operation: "revise_draft" })).toBe(
      fingerprintCommand({ operation: "revise_draft", changes: {} }),
    );
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
    // Tribute event identities and fingerprints are stored the same way.
    expect(
      tributeFingerprint({
        name: "new_subscription",
        created_at: "x",
        payload: {
          b: undefined,
          a: [1, undefined, null],
          Z: 2,
          zeta: { B: 1, a: 2 },
        },
      }),
    ).toBe("c3dfee01596677bc4d3fb8a88b24b4c4c79d12f7bd45fa65aa3502f7b8f30bba");
    expect(tributeFingerprint(["new_subscription", "x", 1, 2])).toBe(
      "0f57fad90ec5346f87369be71c0cc8c935741b36e98c7e1db987fe2f3fc11229",
    );
  });
});

// The opaque body below deliberately contains names that must never be translated.
test("keeps a persisted catalog command digest without rewriting its authored body", () => {
  const command = {
    operation: "apply_product_artifact",
    productId: "b7c1f0e2-0000-4000-8000-000000000003",
    access: "closed",
    body: {
      productId: "authored",
      coverage: { wholePlatform: true },
      access: "closed",
    },
  };
  expect(fingerprintCommand(command)).toBe(
    "ae53bf74f78032f20f35edc2aaeead3b0bee039bbd97bdf451f77938219b7db4",
  );
  expect(
    fingerprintCommand({
      ...command,
      body: { ...command.body, productId: "changed authored content" },
    }),
  ).not.toBe(fingerprintCommand(command));
});
