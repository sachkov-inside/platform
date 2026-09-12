import type { MaterialBlockDefinition } from "./block-definition.js";
import { agentPromptBlock } from "./blocks/agent-prompt.js";
import { blockquoteBlock } from "./blocks/blockquote.js";
import { assetFileBlock, assetImageBlock } from "./blocks/assets.js";
import { calloutBlock } from "./blocks/callout.js";
import { codeBlock } from "./blocks/code-block.js";
import { headingBlock } from "./blocks/heading.js";
import { horizontalRuleBlock } from "./blocks/horizontal-rule.js";
import { keyPointBlock } from "./blocks/key-point.js";
import { labeledListBlock } from "./blocks/labeled-list.js";
import { bulletListBlock, orderedListBlock } from "./blocks/lists.js";
import { paragraphBlock } from "./blocks/paragraph.js";
import { resourceCardBlock } from "./blocks/resource-card.js";
import { tableBlock } from "./blocks/table.js";
import { takeawaysBlock } from "./blocks/takeaways.js";
import { variantBlock } from "./blocks/variant.js";
import type { RenderedBlockKind } from "./rendered-block.js";

/**
 * Every block a material body may contain, in the order the wire contract enumerates them.
 * Adding a block is one entry here plus its appearance in the reading and editing surfaces.
 */
export const materialBlockDefinitions: readonly [
  MaterialBlockDefinition,
  ...MaterialBlockDefinition[],
] = [
  paragraphBlock,
  headingBlock,
  bulletListBlock,
  orderedListBlock,
  blockquoteBlock,
  codeBlock,
  horizontalRuleBlock,
  tableBlock,
  calloutBlock,
  resourceCardBlock,
  agentPromptBlock,
  takeawaysBlock,
  labeledListBlock,
  keyPointBlock,
  variantBlock,
  assetImageBlock,
  assetFileBlock,
];

const definitionsByType = new Map(
  materialBlockDefinitions.map((definition) => [definition.type, definition]),
);

const definitionsByKind = new Map(
  materialBlockDefinitions.map((definition) => [definition.kind, definition]),
);

/**
 * Every block the registry describes carries a stable `nodeId`: reading progress and bookmarks
 * address blocks, and the container nodes that do not appear here — list items, table rows and
 * cells, and the branches of a variant block — are never addressed on their own. A branch address
 * would break at the moment the reader switches mode, which is exactly when it has to hold.
 */
export const addressableMaterialBlockTypes: readonly string[] =
  materialBlockDefinitions.map((definition) => definition.type);

export function materialBlockByType(
  type: string,
): MaterialBlockDefinition | undefined {
  return definitionsByType.get(type);
}

export function materialBlockByKind(
  kind: RenderedBlockKind,
): MaterialBlockDefinition {
  const definition = definitionsByKind.get(kind);
  if (definition === undefined) {
    throw new TypeError(`Unsupported block kind: ${kind}`);
  }
  return definition;
}
