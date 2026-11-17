/** Local image addresses belong to the retained editor DOM, not its visible effects. */
export function createMaterialImagePreviews() {
  const urls = new Map<string, string>();
  let element: HTMLElement | null = null;
  let removal: MutationObserver | null = null;

  const release = () => {
    removal?.disconnect();
    removal = null;
    element = null;
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  return {
    attach(next: HTMLElement) {
      if (element === next) return;
      if (element !== null) release();
      element = next;
      removal = new MutationObserver(() => {
        if (!next.isConnected) release();
      });
      // Retained Activity keeps this DOM connected. Observe the ancestor chain so removal of
      // either the editor or its route releases addresses, without watching document edits.
      for (
        let parent = next.parentNode;
        parent !== null;
        parent = parent.parentNode
      )
        removal.observe(parent, { childList: true });
    },
    imageReady(assetId: string, file: File): Readonly<Record<string, string>> {
      const previous = urls.get(assetId);
      if (previous !== undefined) URL.revokeObjectURL(previous);
      urls.set(assetId, URL.createObjectURL(file));
      return Object.fromEntries(urls);
    },
  };
}
