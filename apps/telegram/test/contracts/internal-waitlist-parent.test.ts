import { parseTraceParent } from "@opentelemetry/core";
import { admitInternalWaitlistParent } from "@inside/contracts/internal-waitlist-parent";
import fixtures from "@inside/contracts/runtime/internal-waitlist-parent-fixtures.json" with { type: "json" };
import { expect, it } from "vitest";

// One shared protocol corpus; app-specific auth/decode/order tests remain at their HTTP boundaries.
it.each(fixtures)(
  "shared Node-parsed waitlist parent protocol: $name",
  ({ headers, parent }) => {
    expect(admitInternalWaitlistParent(headers)).toBe(parent ?? undefined);
    if (parent !== null) {
      expect(parseTraceParent(parent)).not.toBeNull();
      expect(parseTraceParent(parent)?.traceFlags).toBe(
        parent.endsWith("01") ? 1 : 0,
      );
    }
  },
);

it("matches pinned official nonzero-ID semantics without adding an SDK dependency to the protocol owner", () => {
  for (const parent of [
    "00-00000000000000000000000000000001-0000000000000001-00",
    "00-ffffffffffffffffffffffffffffffff-ffffffffffffffff-01",
  ]) {
    expect(admitInternalWaitlistParent(["traceparent", parent])).toBe(parent);
    expect(parseTraceParent(parent)).not.toBeNull();
  }
  for (const parent of [
    "00-00000000000000000000000000000000-0000000000000001-00",
    "00-00000000000000000000000000000001-0000000000000000-01",
  ]) {
    expect(
      admitInternalWaitlistParent(["traceparent", parent]),
    ).toBeUndefined();
    expect(parseTraceParent(parent)).toBeNull();
  }
});
