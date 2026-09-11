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

function collect(
  block: RenderedBlock,
  headings: MaterialBodyHeading[],
  resources: MaterialBodyResourceSummary[],
): void {
  const heading = materialBlockHeading(block);
  if (heading !== undefined) {
    headings.push(heading);
  }
  const resource = materialBlockResource(block);
  if (resource !== undefined) {
    resources.push(resource);
  }
  materialBlockChildren(block).forEach((child) =>
    collect(child, headings, resources),
  );
}

export function extractMaterialBody(
  document: RenderedMaterialBody,
): MaterialBodyExtraction {
  const headings: MaterialBodyHeading[] = [];
  const resources: MaterialBodyResourceSummary[] = [];
  document.blocks.forEach((block) => collect(block, headings, resources));
  return {
    plainText: document.blocks.map(materialBlockText).filter(Boolean).join("\n\n"),
    headings,
    resources,
  };
}
