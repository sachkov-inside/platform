import { expect, it } from "vitest";
import {
  agentChoiceComparison,
  type ReaderBlock,
} from "@/_pages/material-reader";

function cards(): ReaderBlock[] {
  return [
    "Claude Opus 5.5 / Sonnet 5.5",
    "GPT-6.1 Sol / GPT-6 Luna",
    "DeepSeek V4.1 Flash",
    "GLM-5.3-Flash",
    "Kimi K3",
  ].map((title) => ({
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
