import { describe, expect, test } from "vitest";
import {
  signWaitlistIntent,
  verifyWaitlistIntent,
} from "../../src/features/product-waitlist/model/product-waitlist-intent";
const now = new Date("2030-03-01T12:00:00Z");
const key = "test-secret-with-enough-length";
const input = {
  productId: "00000000-0000-4000-8000-000000000001",
  intakeId: "00000000-0000-4000-8000-000000000002",
  accountId: null,
  source: "youtube",
};
describe("explicit same-browser waitlist continuation", () => {
  test("retains intake and source but rejects tampering, wrong signing key and expired continuation", () => {
    const signed = signWaitlistIntent(input, key, now);
    expect(verifyWaitlistIntent(signed, key, now)).toMatchObject(input);
    expect(verifyWaitlistIntent(signed + "x", key, now)).toBeNull();
    expect(verifyWaitlistIntent(signed, "another-key", now)).toBeNull();
    expect(
      verifyWaitlistIntent(signed, key, new Date("2030-03-01T12:16:00Z")),
    ).toBeNull();
    expect(verifyWaitlistIntent(undefined, key, now)).toBeNull();
  });
});
