import type { ImageVariants } from "@inside/material-blocks";

/** The actual article column and its inherited theme own composition, independently of source data. */
export function observeImageComposition(
  element: HTMLElement,
  choose: (choice: keyof ImageVariants<unknown>) => void,
): () => void {
  const update = () => {
    const dark =
      getComputedStyle(element).getPropertyValue("--theme-is-dark").trim() ===
      "1";
    const wide = element.getBoundingClientRect().width >= 560;
    choose(
      wide
        ? dark
          ? "wideDark"
          : "wideLight"
        : dark
          ? "tallDark"
          : "tallLight",
    );
  };
  const resize = new ResizeObserver(update);
  resize.observe(element);
  const theme = new MutationObserver(update);
  for (
    let ancestor: HTMLElement | null = element;
    ancestor !== null;
    ancestor = ancestor.parentElement
  )
    theme.observe(ancestor, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  update();
  return () => {
    resize.disconnect();
    theme.disconnect();
  };
}
