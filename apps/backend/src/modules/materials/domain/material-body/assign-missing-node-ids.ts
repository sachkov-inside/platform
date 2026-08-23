import { randomUUID } from "node:crypto";

import { addressableBlockTypes } from "./document-rules.js";

const addressableBlockTypeSet = new Set<string>(addressableBlockTypes);

export function assignMissingNodeIds(value: unknown, stableRootNodeId?: string): void {
  function visit(candidate: unknown, root: boolean): void {
    if (Array.isArray(candidate)) {
      candidate.forEach((child) => visit(child, false));
      return;
    }
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    const node = candidate as Record<string, unknown>;
    if (typeof node.type === "string" && addressableBlockTypeSet.has(node.type)) {
      if (node.attrs === undefined) {
        node.attrs = { nodeId: root ? stableRootNodeId ?? randomUUID() : randomUUID() };
      } else if (
        node.attrs !== null &&
        !Array.isArray(node.attrs) &&
        typeof node.attrs === "object"
      ) {
        const attributes = node.attrs as Record<string, unknown>;
        if (root && stableRootNodeId !== undefined) {
          attributes.nodeId = stableRootNodeId;
        } else if (attributes.nodeId === undefined || attributes.nodeId === null) {
          attributes.nodeId = randomUUID();
        }
      }
    }
    if (Array.isArray(node.content)) {
      node.content.forEach((child) => visit(child, false));
    }
  }

  visit(value, true);
}
