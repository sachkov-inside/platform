import { Node, getSchema } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import UniqueID from "@tiptap/extension-unique-id";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";

import { addressableBlockTypes } from "../../domain/material-document/document-rules.js";

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: { default: "note" },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", { ...HTMLAttributes, "data-callout": HTMLAttributes.kind }, 0];
  },
});

function localResourceNode(
  name: "assetFile" | "assetImage" | "video",
  attributes: readonly string[],
) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    addAttributes() {
      return Object.fromEntries(attributes.map((attribute) => [attribute, { default: null }]));
    },
    parseHTML() {
      return [{ tag: `div[data-content-node="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-content-node": name }];
    },
  });
}

const AssetImage = localResourceNode("assetImage", ["assetId", "alt", "caption"]);
const AssetFile = localResourceNode("assetFile", ["assetId", "label"]);
const Video = localResourceNode("video", ["videoId", "caption"]);

export const contentExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    hardBreak: false,
    link: {
      HTMLAttributes: { rel: null, target: null },
      openOnClick: false,
    },
    underline: false,
  }),
  TableKit,
  UniqueID.configure({
    attributeName: "nodeId",
    types: [...addressableBlockTypes],
  }),
  Callout,
  AssetImage,
  AssetFile,
  Video,
];

export const materialDocumentSchemaV1: Schema = getSchema(contentExtensions);
