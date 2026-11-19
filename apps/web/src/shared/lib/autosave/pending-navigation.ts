const pendingSaves = new Set<() => Promise<boolean>>();

export async function flushPendingEdits(): Promise<boolean> {
  const participants = new Set(pendingSaves);
  const results = await Promise.all([...participants].map((flush) => flush()));
  return (
    results.every(Boolean) &&
    [...pendingSaves].every((flush) => participants.has(flush))
  );
}

function navigate(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const anchor =
    event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.target === "_blank" ||
    anchor.hasAttribute("download") ||
    (anchor.hash !== "" && anchor.pathname === window.location.pathname)
  )
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void flushPendingEdits().then((ok) => {
    if (ok) window.location.assign(anchor.href);
  });
}

export function registerPendingEdit(flush: () => Promise<boolean>) {
  if (pendingSaves.size === 0)
    document.addEventListener("click", navigate, true);
  pendingSaves.add(flush);
  return () => {
    pendingSaves.delete(flush);
    if (pendingSaves.size === 0)
      document.removeEventListener("click", navigate, true);
  };
}
