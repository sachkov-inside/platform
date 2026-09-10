import { describe, expect, test } from "vitest";
import { commandFingerprint } from "../../src/modules/billing/shared/command-fingerprint.js";

describe("billing command fingerprint", () => {
  test("ignores key order and absent optional fields, but binds every value", () => {
    const command = { operationId: "b7c1f0e2-0000-4000-8000-000000000001", amountKopecks: 100_000, access: "keep" };
    expect(commandFingerprint("refunds.decide", command))
      .toBe(commandFingerprint("refunds.decide", { access: "keep", amountKopecks: 100_000, operationId: command.operationId }));
    expect(commandFingerprint("refunds.decide", { ...command, reason: undefined }))
      .toBe(commandFingerprint("refunds.decide", command));
    expect(commandFingerprint("refunds.decide", { ...command, amountKopecks: 100_001 }))
      .not.toBe(commandFingerprint("refunds.decide", command));
    expect(commandFingerprint("refunds.decide", { ...command, access: "revoke" }))
      .not.toBe(commandFingerprint("refunds.decide", command));
    // Одна нагрузка в разных операциях остаётся разными отпечатками.
    expect(commandFingerprint("refunds.execute", command)).not.toBe(commandFingerprint("refunds.decide", command));
  });
  test("keeps array order significant", () => {
    expect(commandFingerprint("grants.applyBatch", { confirmedRows: ["a", "b"] }))
      .not.toBe(commandFingerprint("grants.applyBatch", { confirmedRows: ["b", "a"] }));
  });
});
