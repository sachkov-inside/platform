import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MaterialAssetNodeView } from "../ui/material-asset-node-view.client";

function assetNode(
  name: "assetFile" | "assetImage",
  attributes: readonly string[],
) {
  return Node.create({
    name,
    atom: true,
    draggable: true,
    addNodeView() {
      return ReactNodeViewRenderer(MaterialAssetNodeView);
    },
    group: "block",
    addAttributes() {
      return Object.fromEntries(
        ["nodeId", ...attributes].map((attribute) => [
          attribute,
          { default: null },
        ]),
      );
    },
    parseHTML() {
      return [{ tag: `[data-material-asset="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      const isImage = name === "assetImage";
      const label = isImage
        ? String(HTMLAttributes.alt ?? "Декоративное изображение")
        : String(HTMLAttributes.label ?? "Файл");
      return [
        isImage ? "figure" : "div",
        mergeAttributes(HTMLAttributes, {
          "data-material-asset": name,
          class: "material-asset-node",
        }),
        [
          "span",
          { class: "material-asset-node__kind" },
          isImage ? "Изображение" : "Файл",
        ],
        ["span", { class: "material-asset-node__label" }, label],
      ];
    },
  });
}

export const MaterialAssetImageNode = assetNode("assetImage", [
  "assetId",
  "alt",
  "caption",
]);
export const MaterialAssetFileNode = assetNode("assetFile", [
  "assetId",
  "label",
]);
