/** A drag left the element itself, not only moved onto one of its children. */
export function dragLeftElement(event: {
  readonly currentTarget: Element;
  readonly relatedTarget: EventTarget | null;
}): boolean {
  return !(
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget)
  );
}
