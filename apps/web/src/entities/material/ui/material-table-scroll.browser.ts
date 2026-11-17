type Overflow = "none" | "start" | "end" | "both";

function overflowOf(element: HTMLElement): Overflow {
  const hidden = element.scrollWidth - element.clientWidth;
  if (hidden <= 1) return "none";
  const atStart = element.scrollLeft <= 1;
  const atEnd = element.scrollLeft >= hidden - 1;
  if (atStart) return "end";
  if (atEnd) return "start";
  return "both";
}

/** Owns the reader table's viewport, content dimensions and their visible edge hints. */
export function mountMaterialTableScroll(element: HTMLDivElement | null) {
  if (element === null) return;
  const frame = element.parentElement;
  if (frame === null) return;
  const start = frame.querySelector<HTMLElement>("[data-table-fade='start']");
  const end = frame.querySelector<HTMLElement>("[data-table-fade='end']");
  if (start === null || end === null) return;

  let active = true;
  const update = () => {
    if (!active) return;
    const overflow = overflowOf(element);
    frame.setAttribute("data-overflow", overflow);
    start.style.opacity =
      overflow === "start" || overflow === "both" ? "1" : "";
    end.style.opacity = overflow === "end" || overflow === "both" ? "1" : "";
  };
  const resize = new ResizeObserver(update);
  resize.observe(element);
  // BodyTable keeps this table while its rows/columns change; the viewport may keep the same size (#2406).
  const table = element.querySelector("table");
  if (table !== null) resize.observe(table);
  element.addEventListener("scroll", update, { passive: true });
  update();
  return () => {
    active = false;
    element.removeEventListener("scroll", update);
    resize.disconnect();
    frame.setAttribute("data-overflow", "none");
    start.style.removeProperty("opacity");
    end.style.removeProperty("opacity");
  };
}
