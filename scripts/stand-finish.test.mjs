// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { finishStand, standFinishSteps } from "./stand-finish.mjs";

test("finish stops the light instance, then releases only an owned reservation", () => {
  assert.deepEqual(
    standFinishSteps.map((step) => step.args),
    [
      ["stand:light", "down"],
      ["stand", "release", "--if-owned"],
    ],
  );
});

test("a failing or hanging step is reported and the next step still runs", async () => {
  /** @type {string[][]} */
  const ran = [];
  /** @type {string[]} */
  const reports = [];
  await finishStand({
    steps: [
      { name: "first", args: ["first"] },
      { name: "second", args: ["second"] },
      { name: "third", args: ["third"] },
    ],
    run: async (args) => {
      ran.push(args);
      if (args[0] === "first") return 1;
      if (args[0] === "second") throw new Error("time limit reached");
      return 0;
    },
    report: (message) => reports.push(message),
  });
  assert.deepEqual(ran, [["first"], ["second"], ["third"]]);
  assert.equal(reports.length, 2);
  assert.match(reports[0] ?? "", /^first: exited with 1/u);
  assert.match(reports[1] ?? "", /^second: time limit reached/u);
});
