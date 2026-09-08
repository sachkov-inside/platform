import { Node } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import UniqueID from "@tiptap/extension-unique-id";
import { StarterKit } from "@tiptap/starter-kit";
import { materialBlockTypes } from "./material-document-identifiers";
import {
  MaterialAssetFileNode,
  MaterialAssetImageNode,
} from "./material-asset-nodes";

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { kind: { default: "note" } };
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", { ...HTMLAttributes, "data-callout": "note" }, 0];
  },
});
// Match the persisted MaterialBody schema so editing cannot silently drop supported blocks.
export const materialDocumentExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    hardBreak: false,
    underline: false,
    link: { openOnClick: false, HTMLAttributes: { rel: null, target: null } },
  }),
  TableKit,
  UniqueID.configure({
    attributeName: "nodeId",
    types: [...materialBlockTypes],
  }),
  Callout,
  MaterialAssetImageNode,
  MaterialAssetFileNode,
];
