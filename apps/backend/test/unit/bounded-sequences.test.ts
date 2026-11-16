import { expect, test } from "vitest";
import {
  boundedSequence,
  checkSequence,
} from "../support/bounded-sequences.js";

test("seed 42 replays a stable trace", () => {
  expect(boundedSequence(42, ["callback", "poll", "repeat"], 5)).toEqual([
    "poll",
    "poll",
    "repeat",
    "callback",
    "callback",
  ]);
});

test("a failing sequence shrinks to its causal event and retains its seed", async () => {
  await expect(
    checkSequence(42, ["poll", "confirm", "repeat"], (steps) => {
      if (steps.includes("confirm"))
        return Promise.reject(new Error("intentional failure"));
      return Promise.resolve();
    }),
  ).rejects.toThrow(
    'PROPERTY_SEED=42; trace=["poll","confirm","repeat"]; reduced=["confirm"]',
  );
});
