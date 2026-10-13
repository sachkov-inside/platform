import type { MaterialBodyComparison } from "@/entities/material";
import type { ReaderBlock } from "./material-reader-view";

const models = [
  { label: "Claude", title: "Claude Opus 5.5 / Sonnet 5.5" },
  { label: "GPT", title: "GPT-6.1 Sol / GPT-6 Luna" },
  { label: "DeepSeek", title: "DeepSeek V4.1 Flash" },
  { label: "GLM", title: "GLM-5.3-Flash" },
  { label: "Kimi", title: "Kimi K3" },
] as const;

/** Owner-selected presentation of this lesson; changed source cards fall back to normal callouts. */
export function agentChoiceComparison(
  materialSlug: string,
  blocks: readonly ReaderBlock[],
): MaterialBodyComparison | undefined {
  if (materialSlug !== "inside-content-aie-ch1-agent-choice") return undefined;
  const at = blocks.findIndex(
    (block) => block.kind === "callout" && block.title === models[0].title,
  );
  if (at < 0) return undefined;
  const matches = models.every((model, offset) => {
    const block = blocks[at + offset];
    return (
      block?.kind === "callout" &&
      block.tone === "note" &&
      block.collapse === "expanded" &&
      block.title === model.title
    );
  });
  return matches
    ? { at, labels: models.map((model) => model.label) }
    : undefined;
}
