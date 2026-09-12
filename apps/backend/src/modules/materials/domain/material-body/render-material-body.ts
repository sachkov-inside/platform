import {
  isJsonArray,
  materialBlockChildren,
  materialBlockHeading,
  materialBlockResource,
  materialBlockText,
  renderMaterialBlocks,
} from "@inside/material-blocks";

import type {
  MaterialBodyExtraction,
  MaterialBodyHeading,
  MaterialBodyResourceSummary,
  MaterialBody,
  RenderedBlock,
  RenderedMaterialBody,
} from "./material-body.js";

export function renderMaterialBody(
  document: MaterialBody,
): RenderedMaterialBody {
  if (document.doc.type !== "doc") {
    throw new TypeError("Expected document root");
  }
  const content = document.doc.content;
  if (content === undefined) {
    return { schemaVersion: 1, blocks: [] };
  }
  if (!isJsonArray(content)) {
    throw new TypeError("Expected document content");
  }
  return { schemaVersion: 1, blocks: renderMaterialBlocks(content) };
}

interface Collected {
  readonly headings: MaterialBodyHeading[];
  modeVariants: boolean;
  readonly resources: MaterialBodyResourceSummary[];
}

function collect(block: RenderedBlock, into: Collected): void {
  const heading = materialBlockHeading(block);
  if (heading !== undefined) {
    into.headings.push(heading);
  }
  const resource = materialBlockResource(block);
  if (resource !== undefined) {
    into.resources.push(resource);
  }
  if (block.kind === "variant") {
    into.modeVariants = true;
  }
  materialBlockChildren(block).forEach((child) => collect(child, into));
}

export function extractMaterialBody(
  document: RenderedMaterialBody,
): MaterialBodyExtraction {
  const collected: Collected = { headings: [], modeVariants: false, resources: [] };
  document.blocks.forEach((block) => collect(block, collected));
  return {
    hasModeVariants: collected.modeVariants,
    plainText: document.blocks.map(materialBlockText).filter(Boolean).join("\n\n"),
    headings: collected.headings,
    resources: collected.resources,
  };
}
