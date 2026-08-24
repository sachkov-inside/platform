import { randomUUID } from "node:crypto";

import { addressableBlockTypes } from "./document-rules.js";
import { isUnknownArray, isUnknownRecord } from "./json-guards.js";

const addressableBlockTypeSet = new Set<string>(addressableBlockTypes);

export function assignMissingNodeIds(value: unknown, stableRootNodeId?: string): void {
  function visit(candidate: unknown, root: boolean): void {
    if (isUnknownArray(candidate)) {
      candidate.forEach((child) => visit(child, false));
      return;
    }
    if (!isUnknownRecord(candidate)) {
      return;
    }
    const node = candidate;
    if (typeof node.type === "string" && addressableBlockTypeSet.has(node.type)) {
      if (node.attrs === undefined) {
        node.attrs = { nodeId: root ? stableRootNodeId ?? randomUUID() : randomUUID() };
      } else if (
        isUnknownRecord(node.attrs)
      ) {
        const attributes = node.attrs;
        if (root && stableRootNodeId !== undefined) {
          attributes.nodeId = stableRootNodeId;
        } else if (attributes.nodeId === undefined || attributes.nodeId === null) {
          attributes.nodeId = randomUUID();
        }
      }
    }
    if (isUnknownArray(node.content)) {
      node.content.forEach((child) => visit(child, false));
    }
  }

  visit(value, true);
}
