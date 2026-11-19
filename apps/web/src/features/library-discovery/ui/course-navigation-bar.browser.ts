/** The fixed dock owns its actual flow clearance and the notice offset beneath it. */
export function mountCourseNavigationSpace(navigation: HTMLElement | null) {
  if (navigation === null) return;
  const space = navigation.previousElementSibling;
  if (
    !(space instanceof HTMLElement) ||
    !space.hasAttribute("data-course-navigation-space")
  )
    return;

  let active = true;
  const measure = () => {
    if (!active) return;
    const height = navigation.getBoundingClientRect().height;
    const bottom = Number.parseFloat(getComputedStyle(navigation).bottom);
    space.style.height = `${String(height === 0 ? 0 : height + bottom + 12)}px`;
  };
  const dimensions = new ResizeObserver(measure);
  // The storage notice changes computed bottom without changing the dock's observed size (#2404).
  const noticeOffset = new MutationObserver(measure);
  dimensions.observe(navigation);
  noticeOffset.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
  measure();
  return () => {
    active = false;
    dimensions.disconnect();
    noticeOffset.disconnect();
    space.style.height = "0px";
  };
}
