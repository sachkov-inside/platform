export function resetContent(node: Element) {
  node.closest("[data-application-content]")?.scrollTo({ top: 0 });
}
