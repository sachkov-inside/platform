import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { materialDocumentExtensions } from "@inside/material-blocks/schema";
import { MaterialAssetNodeView } from "../ui/material-asset-node-view.client";

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
// The registry owns every block; the editor only adds its own appearance and shortcuts.
const assetNodeView = () => ReactNodeViewRenderer(MaterialAssetNodeView);

export const materialEditorExtensions = [
  ...materialDocumentExtensions({
    nodeViews: { assetFile: assetNodeView, assetImage: assetNodeView },
  }),
  ExitMaterialBlock,
];
