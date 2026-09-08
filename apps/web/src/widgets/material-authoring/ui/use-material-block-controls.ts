"use client";

import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";

/** Position controls beside a document block without changing the writing layout. */
export function useMaterialBlockControls(
  editor: Editor | null,
  frozen: boolean,
) {
  const surface = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const [anchor, setAnchor] = useState({ top: 24, left: 0 });
  const [selection, setSelection] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const place = useCallback(
    (pos: number) => {
      if (!editor || !surface.current) return;
      const element = editor.view.nodeDOM(pos);
      if (!(element instanceof HTMLElement)) return;
      const block = element.getBoundingClientRect();
      const bounds = surface.current.getBoundingClientRect();
      position.current = pos;
      setAnchor({
        top: block.top - bounds.top,
        left: Math.max(0, block.left - bounds.left - 36),
      });
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const update = (transaction?: Transaction) => {
      if (!surface.current || editor.isDestroyed) return;
      const { $from, empty, from } = editor.state.selection;
      if (frozen) {
        if (transaction?.docChanged)
          position.current = transaction.mapping.map(position.current);
        place(position.current);
      } else place($from.depth > 0 ? $from.before(1) : $from.pos);
      if (empty || !(editor.state.selection instanceof TextSelection))
        setSelection(null);
      else {
        const point = editor.view.coordsAtPos(from);
        const bounds = surface.current.getBoundingClientRect();
        setSelection({
          top: Math.max(0, point.top - bounds.top - 46),
          left: Math.min(
            Math.max(0, point.left - bounds.left),
            Math.max(0, bounds.width - 150),
          ),
        });
      }
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      update(transaction);
    };
    editor.on("transaction", onTransaction);
    const observer = new ResizeObserver(() => {
      update();
    });
    if (surface.current) observer.observe(surface.current);
    update();
    return () => {
      editor.off("transaction", onTransaction);
      observer.disconnect();
    };
  }, [editor, frozen, place]);

  const hover = (target: EventTarget) => {
    if (!editor || frozen || !(target instanceof HTMLElement)) return;
    let block = target;
    while (block.parentElement && block.parentElement !== editor.view.dom)
      block = block.parentElement;
    if (block.parentElement !== editor.view.dom) return;
    editor.state.doc.forEach((_node, offset) => {
      if (editor.view.nodeDOM(offset) === block) place(offset);
    });
  };

  const insertionPosition = () => {
    if (!editor) return 0;
    const pos = Math.min(position.current, editor.state.doc.content.size);
    const node = editor.state.doc.nodeAt(pos);
    return node?.type.name === "paragraph" && node.content.size === 0
      ? pos + 1
      : pos + (node?.nodeSize ?? 0);
  };

  const prepareTextBlock = () => {
    if (!editor) return;
    const pos = insertionPosition();
    const resolved = editor.state.doc.resolve(pos);
    if (
      resolved.parent.type.name === "paragraph" &&
      resolved.parent.content.size === 0
    )
      editor.commands.setTextSelection(pos);
    else
      editor
        .chain()
        .insertContentAt(pos, { type: "paragraph" })
        .setTextSelection(pos + 1)
        .run();
  };

  return {
    surface,
    anchor,
    selection,
    hover,
    insertionPosition,
    prepareTextBlock,
  };
}
