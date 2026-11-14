/**
 * The zoom control hangs below the picture's right edge, in the caption row the figure reserves
 * for it, so it never covers a corner of the picture.
 */
export const zoomControlClassName =
  "absolute top-full right-0 z-10 flex size-11 cursor-zoom-in items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-(--motion-duration-fast) hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none";

/** Phones, where a tap on a figure opens it large. Matches Tailwind's `max-md`. */
export const NARROW_SCREEN = "(width < 48rem)";
