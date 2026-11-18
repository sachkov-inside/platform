export function observeCatalogContinuation(
  sentinel: HTMLElement,
  loadNextPage: () => void,
): () => void {
  let active = true;
  const observer = new IntersectionObserver(
    (entries) => {
      if (active && entries.some((entry) => entry.isIntersecting))
        loadNextPage();
    },
    { rootMargin: "800px 0px" },
  );
  observer.observe(sentinel);
  return () => {
    active = false;
    observer.disconnect();
  };
}
