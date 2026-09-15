"use client";

import type { Node } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { blockMayHaveMoved } from "../model/block-controls-placement";

interface Offset {
  readonly top: number;
  readonly left: number;
}

/** Что было прочитано последним замером: по этому транзакция решает, нужен ли следующий. */
interface Measurement {
  readonly doc: Node;
  readonly element: globalThis.Node | null;
  readonly position: number;
  readonly toolbarFrom: number | null;
}

const initialAnchor: Offset = { top: 24, left: 0 };

/**
 * Держит контролы рядом с блоком документа, не меняя вёрстку текста.
 *
 * Положение читается из вёрстки не чаще раза за кадр и только когда оно могло измениться: сменился
 * блок, выделение под панелью форматирования, блоки перед текущим, размер поверхности или
 * документа, состав поверхности. Знак, набранный внутри блока, вёрстку не читает и React не будит.
 * Замер идёт в кадре, который ещё не нарисован, и применяется синхронно, поэтому контролы встают в
 * том же кадре, что и правка документа.
 */
export function useMaterialBlockControls(
  editor: Editor | null,
  frozen: boolean,
) {
  const surface = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const measurement = useRef<Measurement | null>(null);
  const frame = useRef<number | null>(null);
  const shown = useRef<{ anchor: Offset; selection: Offset | null }>({
    anchor: initialAnchor,
    selection: null,
  });
  const [anchor, setAnchor] = useState<Offset>(initialAnchor);
  const [selection, setSelection] = useState<Offset | null>(null);

  /** Все чтения вёрстки одного обновления подряд, без записей между ними. */
  const measure = useCallback(() => {
    frame.current = null;
    if (!editor || editor.isDestroyed || !surface.current) return;
    const { state, view } = editor;
    const element = view.nodeDOM(position.current);
    const toolbarFrom = formattingToolbarFrom(editor);
    const bounds = surface.current.getBoundingClientRect();
    let nextAnchor = shown.current.anchor;
    if (element instanceof HTMLElement) {
      const block = element.getBoundingClientRect();
      nextAnchor = {
        top: block.top - bounds.top,
        left: Math.max(0, block.left - bounds.left - 36),
      };
    }
    let nextSelection: Offset | null = null;
    if (toolbarFrom !== null) {
      const point = view.coordsAtPos(toolbarFrom);
      nextSelection = {
        top: Math.max(0, point.top - bounds.top - 46),
        left: Math.min(
          Math.max(0, point.left - bounds.left),
          Math.max(0, bounds.width - 150),
        ),
      };
    }
    measurement.current = {
      doc: state.doc,
      element,
      position: position.current,
      toolbarFrom,
    };
    if (
      sameOffset(shown.current.anchor, nextAnchor) &&
      sameOffset(shown.current.selection, nextSelection)
    )
      return;
    shown.current = { anchor: nextAnchor, selection: nextSelection };
    flushSync(() => {
      setAnchor(nextAnchor);
      setSelection(nextSelection);
    });
  }, [editor]);

  const schedule = useCallback(() => {
    frame.current ??= requestAnimationFrame(measure);
  }, [measure]);

  /** Замер назначается, только если с прошлого что-то из прочитанного могло измениться. */
  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed || frame.current !== null) return;
    const previous = measurement.current;
    const { doc } = editor.state;
    const toolbarFrom = formattingToolbarFrom(editor);
    if (
      previous === null ||
      previous.position !== position.current ||
      previous.toolbarFrom !== toolbarFrom ||
      (toolbarFrom !== null && previous.doc !== doc) ||
      editor.view.nodeDOM(position.current) !== previous.element ||
      blockMayHaveMoved(previous.doc, doc, position.current)
    )
      schedule();
  }, [editor, schedule]);

  /** Блок под контролами меняется только на тот, у которого есть DOM-узел. */
  const retarget = useCallback(
    (pos: number) => {
      if (editor?.view.nodeDOM(pos) instanceof HTMLElement)
        position.current = pos;
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const follow = (transaction?: Transaction) => {
      if (editor.isDestroyed) return;
      if (frozen) {
        if (transaction?.docChanged)
          position.current = transaction.mapping.map(position.current);
      } else {
        const { $from } = editor.state.selection;
        retarget($from.depth > 0 ? $from.before(1) : $from.pos);
      }
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      follow(transaction);
      refresh();
    };
    editor.on("transaction", onTransaction);
    // Вёрстка может сдвинуть блок и без транзакции: загрузилась картинка выше, появилась очередь
    // загрузок над документом. Высота документа и состав поверхности ловят оба случая.
    const layout = new ResizeObserver(() => {
      schedule();
    });
    const overlays = new MutationObserver(() => {
      schedule();
    });
    if (surface.current) {
      layout.observe(surface.current);
      overlays.observe(surface.current, { childList: true });
    }
    layout.observe(editor.view.dom);
    follow();
    measurement.current = null;
    schedule();
    return () => {
      editor.off("transaction", onTransaction);
      layout.disconnect();
      overlays.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [editor, frozen, refresh, retarget, schedule]);

  const hover = (target: EventTarget) => {
    if (!editor || frozen || !(target instanceof HTMLElement)) return;
    let block = target;
    while (block.parentElement && block.parentElement !== editor.view.dom)
      block = block.parentElement;
    if (block.parentElement !== editor.view.dom) return;
    editor.state.doc.forEach((_node, offset) => {
      if (editor.view.nodeDOM(offset) === block) retarget(offset);
    });
    refresh();
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

/** Начало текстового выделения, над которым стоит панель форматирования, или `null`, если панели нет. */
function formattingToolbarFrom(editor: Editor): number | null {
  const { selection } = editor.state;
  return selection.empty || !(selection instanceof TextSelection)
    ? null
    : selection.from;
}

function sameOffset(previous: Offset | null, next: Offset | null): boolean {
  if (previous === null || next === null) return previous === next;
  return previous.top === next.top && previous.left === next.left;
}
