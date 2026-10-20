import { expect, it } from "vitest";
import { admitInternalWaitlistParent } from "../../src/observability/internal-waitlist-parent.js";

const parent = "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01";

it("admits exactly one canonical parent field independent of header name casing", () => {
  expect(
    admitInternalWaitlistParent([
      "Host",
      "synthetic.invalid",
      "TraceParent",
      parent,
    ]),
  ).toBe(parent);
  expect(
    admitInternalWaitlistParent(["traceparent", parent.slice(0, -2) + "00"]),
  ).toBe(parent.slice(0, -2) + "00");
});

it.each([
  [],
  ["host", "synthetic.invalid"],
  ["traceparent", parent, "TraceParent", parent],
  ["TRACEPARENT", parent, "traceparent", parent.slice(0, -2) + "00"],
  ["traceparent"],
  ["traceparent", ` ${parent}`],
  ["traceparent", `${parent} `],
  ["traceparent", `${parent},${parent}`],
  ["traceparent", `${parent}\n`],
  ["traceparent", parent.toUpperCase()],
  ["traceparent", "01" + parent.slice(2)],
  ["traceparent", parent.slice(0, -2) + "ff"],
  ["traceparent", parent.slice(0, -2) + "02"],
  ["traceparent", "00-00000000000000000000000000000000-1234567890abcdef-01"],
  ["traceparent", "00-1234567890abcdef1234567890abcdef-0000000000000000-01"],
  ["traceparent", parent + "-extra"],
  ["traceparent", parent.slice(0, -1)],
])("ignores noncanonical or duplicate raw header sequence %#", (...headers) => {
  expect(admitInternalWaitlistParent(headers)).toBeUndefined();
});
