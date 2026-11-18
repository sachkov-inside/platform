import { keepShellScrollAcrossBreakpoint } from "@/shared/lib/shell-scroll";

/** Owns the shell's two scroll roots and its scroll-responsive mobile header. */
export function mountApplicationShell(content: HTMLElement | null) {
  if (content === null) return;
  const stopTransfer = keepShellScrollAcrossBreakpoint(content);
  const header = content
    .closest("[data-application-shell]")
    ?.querySelector<HTMLElement>("[data-mobile-header]");
  if (header === undefined || header === null) return stopTransfer;

  let previous = window.scrollY;
  const onScroll = () => {
    const current = Math.max(0, window.scrollY);
    if (Math.abs(current - previous) < 4) return;
    header.toggleAttribute(
      "data-scroll-hidden",
      current > 56 && current > previous,
    );
    previous = current;
  };
  const reveal = () => {
    header.removeAttribute("data-scroll-hidden");
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  header.addEventListener("focusin", reveal, true);
  return () => {
    // A retained header keeps its visual state while its browser listeners are inactive (#2399).
    stopTransfer();
    window.removeEventListener("scroll", onScroll);
    header.removeEventListener("focusin", reveal, true);
  };
}
