import { Extension, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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
// Leave the whole top-level block, including nested table/list content.
const ExitMaterialBlock = Extension.create({
  name: "exitMaterialBlock",
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => {
        const { state, view } = this.editor;
        // A click can move the visible caret before selectionchange reaches the model.
        // Resolve the current DOM caret through ProseMirror's public mapping API.
        const selection = view.dom.ownerDocument.getSelection();
        const caret =
          selection?.isCollapsed &&
          selection.anchorNode &&
          view.dom.contains(selection.anchorNode)
            ? view.posAtDOM(selection.anchorNode, selection.anchorOffset)
            : state.selection.from;
        const $from = state.doc.resolve(caret);
        const position =
          $from.depth > 0
            ? $from.after(1)
            : $from.pos + (state.doc.nodeAt($from.pos)?.nodeSize ?? 0);
        const paragraph = state.schema.nodes.paragraph?.create();
        if (!paragraph) return false;
        const transaction = state.tr.insert(position, paragraph);
        transaction.setSelection(
          TextSelection.create(transaction.doc, position + 1),
        );
        transaction.setStoredMarks([]);
        view.dispatch(transaction.scrollIntoView());
        return true;
      },
    };
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
  ExitMaterialBlock,
  UniqueID.configure({
    attributeName: "nodeId",
    types: [...materialBlockTypes],
  }),
  Callout,
  MaterialAssetImageNode,
  MaterialAssetFileNode,
];
