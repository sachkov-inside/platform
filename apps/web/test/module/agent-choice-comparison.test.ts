import { expect, it } from "vitest";
import {
  agentChoiceComparison,
  type ReaderBlock,
} from "@/_pages/material-reader";

function cards(
  titles = [
    "Claude Opus 5.5 / Sonnet 5.5",
    "GPT-6.1 Sol / GPT-6.1 Terra / GPT-6 Luna",
    "DeepSeek V4.1 Flash",
    "GLM-5.3-Flash",
    "Kimi K3.1 Pro",
  ],
): ReaderBlock[] {
  return titles.map((title) => ({
    kind: "callout",
    tone: "note",
    collapse: "expanded",
    title,
    content: [],
  }));
}

it("groups only the accepted contiguous cards in the agent-choice lesson", () => {
  const blocks: ReaderBlock[] = [
    { kind: "paragraph", content: [] },
    ...cards(),
  ];
  expect(
    agentChoiceComparison("inside-content-aie-ch1-agent-choice", blocks),
  ).toEqual({ at: 1, labels: ["Claude", "GPT", "DeepSeek", "GLM", "Kimi"] });
  expect(agentChoiceComparison("another-lesson", blocks)).toBeUndefined();
});

it("leaves changed, missing or interrupted source cards as ordinary callouts", () => {
  const changed = cards();
  changed[2] = {
    kind: "callout",
    tone: "note",
    collapse: "expanded",
    title: "New model",
    content: [],
  };
  const interrupted = cards();
  interrupted.splice(2, 0, { kind: "paragraph", content: [] });
  for (const blocks of [changed, interrupted, cards().slice(0, 4)]) {
    expect(
      agentChoiceComparison("inside-content-aie-ch1-agent-choice", blocks),
    ).toBeUndefined();
  }
});

it("recognizes later model versions without changing labels or source blocks", () => {
  const blocks = cards([
    "Claude Opus future / Sonnet future",
    "GPT-next Sol / GPT-next Terra / GPT-next Luna",
    "DeepSeek V-next Reasoner",
    "GLM-next-Air",
    "Kimi next Thinking",
  ]);
  const original = structuredClone(blocks);
  expect(
    agentChoiceComparison("inside-content-aie-ch1-agent-choice", blocks),
  ).toEqual({ at: 0, labels: ["Claude", "GPT", "DeepSeek", "GLM", "Kimi"] });
  expect(blocks).toEqual(original);
});

it("finds the complete sequence after an unrelated model callout", () => {
  const unrelated: ReaderBlock = {
    kind: "callout",
    tone: "note",
    collapse: "expanded",
    title: "Claude setup",
    content: [],
  };
  expect(
    agentChoiceComparison("inside-content-aie-ch1-agent-choice", [
      unrelated,
      ...cards(),
    ]),
  ).toEqual({ at: 1, labels: ["Claude", "GPT", "DeepSeek", "GLM", "Kimi"] });
});

it.each([
  { title: "Claudeish model" },
  { title: "About Claude" },
  { title: undefined },
  { tone: "tip" as const },
  { collapse: "collapsed" as const },
  { collapse: undefined },
])("keeps a nonmatching block contract as ordinary callouts: %j", (change) => {
  const blocks = cards();
  blocks[0] = {
    kind: "callout",
    tone: "note",
    collapse: "expanded",
    title: "Claude Opus",
    content: [],
    ...change,
  };
  expect(
    agentChoiceComparison("inside-content-aie-ch1-agent-choice", blocks),
  ).toBeUndefined();
});

it("keeps reordered families as ordinary callouts", () => {
  const blocks = cards();
  [blocks[1], blocks[2]] = [blocks[2]!, blocks[1]!];
  expect(
    agentChoiceComparison("inside-content-aie-ch1-agent-choice", blocks),
  ).toBeUndefined();
});
