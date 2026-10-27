import type { MaterialBodyComparison } from "@/entities/material";
import type { ReaderBlock } from "./material-reader-view";

const models = [
  { label: "Claude", title: /^Claude(?:[\s-]|$)/u },
  { label: "GPT", title: /^GPT(?:[\s-]|$)/u },
  { label: "DeepSeek", title: /^DeepSeek(?:[\s-]|$)/u },
  { label: "GLM", title: /^GLM(?:[\s-]|$)/u },
  { label: "Kimi", title: /^Kimi(?:[\s-]|$)/u },
] as const;

/**
 * This lesson's five model families own the selector, not their changing version suffixes.
 * The block contract has no comparison ID: retain the slug, order and expanded-note guards,
 * and leave an incomplete or unrelated sequence as ordinary callouts. Source titles/content
 * remain untouched, including when authors reduce each card to price and opinion.
 */
export function agentChoiceComparison(
  materialSlug: string,
  blocks: readonly ReaderBlock[],
): MaterialBodyComparison | undefined {
  if (materialSlug !== "inside-content-aie-ch1-agent-choice") return undefined;
  const at = blocks.findIndex((_, index) =>
    models.every((model, offset) => {
      const block = blocks[index + offset];
      return (
        block?.kind === "callout" &&
        block.tone === "note" &&
        block.collapse === "expanded" &&
        block.title !== undefined &&
        model.title.test(block.title)
      );
    }),
  );
  return at < 0
    ? undefined
    : { at, labels: models.map((model) => model.label) };
}
