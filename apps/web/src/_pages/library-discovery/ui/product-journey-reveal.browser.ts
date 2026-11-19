/** Observes the programme's last shown lesson until that actual DOM lifetime ends. */
export function observeProgrammeReveal(
  node: HTMLLIElement,
  checkOnAttach: boolean,
  onReached: () => void,
): (() => void) | undefined {
  if (typeof IntersectionObserver === "undefined") return;
  const revealAheadPixels = 600;
  let observer: IntersectionObserver | undefined;
  let scrollTarget: Element | Document = node.ownerDocument;
  let frame: number | undefined;
  let revealed = false;
  let closed = false;

  const revealNextBatch = () => {
    if (closed || revealed) return;
    revealed = true;
    observer?.disconnect();
    onReached();
  };
  const checkReachedBoundary = () => {
    frame = undefined;
    if (closed || node.getClientRects().length === 0) return;
    const bottom =
      scrollTarget instanceof Element
        ? scrollTarget.getBoundingClientRect().bottom
        : window.innerHeight;
    if (node.getBoundingClientRect().top <= bottom + revealAheadPixels)
      revealNextBatch();
  };
  const scheduleBoundaryCheck = () => {
    if (!closed && frame === undefined && !revealed)
      frame = requestAnimationFrame(checkReachedBoundary);
  };
  const observeLastLesson = () => {
    if (closed) return;
    observer?.disconnect();
    scrollTarget.removeEventListener("scroll", scheduleBoundaryCheck);
    // The actual scroll owner changes between the shell main and the document.
    let root = node.parentElement;
    while (
      root !== null &&
      !/^(auto|scroll)$/.test(getComputedStyle(root).overflowY)
    ) {
      root = root.parentElement;
    }
    scrollTarget = root ?? node.ownerDocument;
    observer = new IntersectionObserver(
      (entries, deliveredBy) => {
        if (observer !== deliveredBy) return;
        if (entries.some((entry) => entry.isIntersecting)) revealNextBatch();
      },
      {
        root: scrollTarget,
        rootMargin: `0px 0px ${String(revealAheadPixels)}px 0px`,
      },
    );
    observer.observe(node);
    // End/scrollbar jumps can pass the intersection region between frames.
    scrollTarget.addEventListener("scroll", scheduleBoundaryCheck, {
      passive: true,
    });
    if (checkOnAttach) scheduleBoundaryCheck();
  };
  const onResize = () => {
    observeLastLesson();
    scheduleBoundaryCheck();
  };
  observeLastLesson();
  window.addEventListener("resize", onResize);
  return () => {
    if (closed) return;
    closed = true;
    observer?.disconnect();
    scrollTarget.removeEventListener("scroll", scheduleBoundaryCheck);
    window.removeEventListener("resize", onResize);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
