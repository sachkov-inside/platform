import { describe, expect, test } from "vitest";

import { fingerprintCommand } from "../../src/modules/materials/application/shared/canonical-command-fingerprint.js";

describe("ContentAuthoring command fingerprint", () => {
  test("fingerprints a canonical, versioned request envelope", () => {
    expect(fingerprintCommand({ operation: "revise_draft", changes: {} })).toBe(
      "86e65b719b29a3f3c8f2ee0d79820728bd97e566f889110bc88d17159558b4ab",
    );
    expect(
      fingerprintCommand({ changes: {}, operation: "revise_draft" }),
    ).toBe(fingerprintCommand({ operation: "revise_draft", changes: {} }));
  });
});
