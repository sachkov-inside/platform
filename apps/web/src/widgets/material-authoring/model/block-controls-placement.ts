import type { Node } from "@tiptap/pm/model";

/**
 * Может ли блок верхнего уровня, который начинается в `position`, стоять на экране в другом месте
 * после перехода документа от `previous` к `next`.
 *
 * Верх блока задают блоки перед ним и его собственное устройство. Правка только текста внутри
 * блока не меняет ни то, ни другое, поэтому знак, набранный в абзаце, не требует нового замера.
 * ProseMirror переносит нетронутые узлы в новый документ теми же объектами, так что проверка
 * соседей — сравнение ссылок, а не обход документа.
 *
 * Атрибуты самого блока не сравниваются: поля карточки и терминов пишутся в атрибуты на каждый
 * знак, а верх блока от них не зависит. Когда атрибут меняет разметку блока, ProseMirror создаёт
 * новый DOM-узел, и это ловит сравнение узлов у вызывающей стороны.
 *
 * Позиция не на границе блока верхнего уровня — ответ «может»: решает замер.
 */
export function blockMayHaveMoved(
  previous: Node,
  next: Node,
  position: number,
): boolean {
  if (previous === next) return false;
  let offset = 0;
  for (let index = 0; index < next.childCount; index += 1) {
    const block = next.child(index);
    const before = previous.maybeChild(index);
    if (offset === position) {
      return (
        before === null ||
        before.type !== block.type ||
        !sameChildrenShape(before, block)
      );
    }
    if (offset > position || before !== block) return true;
    offset += block.nodeSize;
  }
  return true;
}

/**
 * Дочерние узлы отличаются только текстом: те же типы, атрибуты и отметки на тех же местах.
 * Вложенный заголовок или новый пункт списка могут сдвинуть верх блока через схлопывание отступов,
 * а знак в тексте — нет.
 */
function sameChildrenShape(previous: Node, next: Node): boolean {
  if (previous.childCount !== next.childCount) return false;
  for (let index = 0; index < next.childCount; index += 1) {
    const before = previous.child(index);
    const after = next.child(index);
    if (before === after) continue;
    if (!before.sameMarkup(after)) return false;
    if (!after.isText && !sameChildrenShape(before, after)) return false;
  }
  return true;
}
