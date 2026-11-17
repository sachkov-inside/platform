export interface TermDeckTrackSnapshot {
  readonly index: number;
  readonly scrollable: boolean;
  readonly selectionRevision: number;
}

interface TrackBinding {
  readonly goTo: (place: number, focus: boolean) => void;
  readonly dispose: () => void;
}

const initialSnapshot: TermDeckTrackSnapshot = {
  index: 0,
  scrollable: false,
  selectionRevision: 0,
};
const dragThreshold = 6;
const dragFlick = 40;

/**
 * Owns one carousel track's scrolling, pointer gestures, geometry and focus. Subscriptions lease
 * browser resources; the selection survives a retained view's disconnect and reconnect.
 */
export function createTermDeckTrack() {
  let snapshot = initialSnapshot;
  let element: HTMLDivElement | null = null;
  let binding: TrackBinding | undefined;
  let connection = 0;
  const listeners = new Set<() => void>();

  const publish = (next: TermDeckTrackSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const show = (index: number) => {
    if (index === snapshot.index) return;
    publish({
      ...snapshot,
      index,
      selectionRevision: snapshot.selectionRevision + 1,
    });
  };

  function mount(track: HTMLDivElement): TrackBinding {
    let disposed = false;
    let frame = 0;
    let requestedIndex: number | null = null;
    let swallowClick = false;
    let drag: {
      readonly pointerId: number;
      readonly startX: number;
      readonly startLeft: number;
      readonly startIndex: number;
      lastX: number;
      moved: boolean;
    } | null = null;

    const edges = () => {
      const more = track.scrollWidth - track.clientWidth;
      if (track.scrollLeft > 1) track.dataset["moreBefore"] = "";
      else delete track.dataset["moreBefore"];
      if (more > 1 && track.scrollLeft < more - 1)
        track.dataset["moreAfter"] = "";
      else delete track.dataset["moreAfter"];
    };
    const goTo = (place: number, focus: boolean) => {
      if (disposed) return;
      const all = slides(track);
      const target = Math.max(0, Math.min(all.length - 1, place));
      const slide = all[target];
      if (slide === undefined) return;
      requestedIndex = target;
      show(target);
      track.scrollTo({
        left: slideScrollLeft(track, slide),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      if (focus)
        slide
          .querySelector<HTMLElement>("[data-lesson-term-card]")
          ?.focus({ preventScroll: true });
    };
    const settle = () => {
      frame = 0;
      if (disposed) return;
      edges();
      const nearest = visibleSlide(track);
      if (requestedIndex !== null) {
        if (nearest !== requestedIndex) return;
        requestedIndex = null;
      }
      show(nearest);
    };
    const onScroll = () => {
      if (!disposed && frame === 0) frame = requestAnimationFrame(settle);
    };
    const takeOver = () => {
      requestedIndex = null;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (drag !== null && event.pointerId !== drag.pointerId) return;
      swallowClick = false;
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      requestedIndex = null;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        lastX: event.clientX,
        startLeft: track.scrollLeft,
        startIndex: snapshot.index,
        moved: false,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      drag.lastX = event.clientX;
      const travel = event.clientX - drag.startX;
      if (!drag.moved) {
        if (Math.abs(travel) < dragThreshold) return;
        drag.moved = true;
        track.dataset["dragging"] = "";
        try {
          track.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events have no active native pointer to capture.
        }
      }
      event.preventDefault();
      track.scrollLeft = drag.startLeft - travel;
    };
    const endDrag = (pointerId: number, clientX: number) => {
      if (disposed || drag === null || pointerId !== drag.pointerId) return;
      const { moved, startIndex, startX } = drag;
      drag = null;
      if (!moved) return;
      delete track.dataset["dragging"];
      swallowClick = true;
      const travel = clientX - startX;
      let target = visibleSlide(track);
      if (target === startIndex && Math.abs(travel) >= dragFlick)
        target += travel < 0 ? 1 : -1;
      goTo(target, false);
    };
    const onPointerEnd = (event: PointerEvent) => {
      endDrag(event.pointerId, event.clientX);
    };
    const onLostCapture = (event: PointerEvent) => {
      if (drag !== null) endDrag(event.pointerId, drag.lastX);
    };
    const onClickCapture = (event: MouseEvent) => {
      if (disposed || !swallowClick || event.detail === 0) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const measure = () => {
      if (disposed) return;
      edges();
      const scrollable = track.scrollWidth > track.clientWidth + 1;
      if (scrollable !== snapshot.scrollable)
        publish({ ...snapshot, scrollable });
    };
    const contentsChanged = () => {
      if (disposed) return;
      requestedIndex = null;
      measure();
      goTo(snapshot.index, false);
    };

    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("wheel", takeOver, { passive: true });
    track.addEventListener("touchstart", takeOver, { passive: true });
    track.addEventListener("pointerdown", onPointerDown);
    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", onPointerEnd);
    track.addEventListener("pointercancel", onPointerEnd);
    track.addEventListener("lostpointercapture", onLostCapture);
    track.addEventListener("click", onClickCapture, true);
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    const contents = new MutationObserver(contentsChanged);
    contents.observe(track, { childList: true });
    measure();
    if (snapshot.index >= slides(track).length)
      goTo(slides(track).length - 1, false);

    return {
      goTo,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const pointerId = drag?.pointerId;
        drag = null;
        delete track.dataset["dragging"];
        delete track.dataset["moreBefore"];
        delete track.dataset["moreAfter"];
        track.removeEventListener("scroll", onScroll);
        track.removeEventListener("wheel", takeOver);
        track.removeEventListener("touchstart", takeOver);
        track.removeEventListener("pointerdown", onPointerDown);
        track.removeEventListener("pointermove", onPointerMove);
        track.removeEventListener("pointerup", onPointerEnd);
        track.removeEventListener("pointercancel", onPointerEnd);
        track.removeEventListener("lostpointercapture", onLostCapture);
        track.removeEventListener("click", onClickCapture, true);
        resize.disconnect();
        contents.disconnect();
        if (frame !== 0) cancelAnimationFrame(frame);
        if (pointerId !== undefined && track.hasPointerCapture(pointerId))
          track.releasePointerCapture(pointerId);
      },
    };
  }

  const activate = () => {
    if (element !== null && binding === undefined && listeners.size > 0)
      binding = mount(element);
  };
  const deactivate = () => {
    binding?.dispose();
    binding = undefined;
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      activate();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) deactivate();
      };
    },
    connect: (track: HTMLDivElement) => {
      deactivate();
      element = track;
      const lease = ++connection;
      activate();
      return () => {
        if (lease !== connection) return;
        deactivate();
        element = null;
      };
    },
    goTo: (place: number, focus: boolean) => {
      binding?.goTo(place, focus);
    },
  };
}

function slides(track: HTMLElement): HTMLElement[] {
  return [...track.querySelectorAll<HTMLElement>("[data-lesson-term-slide]")];
}

function slideScrollLeft(track: HTMLElement, slide: HTMLElement): number {
  return slide.offsetLeft - (slides(track)[0]?.offsetLeft ?? 0);
}

function visibleSlide(track: HTMLElement): number {
  const all = slides(track);
  if (track.scrollWidth <= track.clientWidth + 1) return 0;
  if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 1)
    return Math.max(0, all.length - 1);
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  all.forEach((slide, place) => {
    const gap = Math.abs(slideScrollLeft(track, slide) - track.scrollLeft);
    if (gap < distance) {
      distance = gap;
      nearest = place;
    }
  });
  return nearest;
}
