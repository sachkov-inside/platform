import { expect, test } from "vitest";
import { assertPayloadBudget } from "../support/payload-budgets";

test("the measured programme and film payloads fit the regression budgets", () => {
  expect(() => {
    assertPayloadBudget("programmeFlight", 927_610);
  }).not.toThrow();
  expect(() => {
    assertPayloadBudget("courseScripts", 1_276_051);
  }).not.toThrow();
});

test("oversized or missing measurements fail instead of becoming a metrics-only attachment", () => {
  expect(() => {
    assertPayloadBudget("programmeFlight", 1_100_001);
  }).toThrow("programmeFlight");
  expect(() => {
    assertPayloadBudget("courseScripts", 1_500_001);
  }).toThrow("courseScripts");
  expect(() => {
    assertPayloadBudget("courseScripts", Number.NaN);
  }).toThrow();
});
