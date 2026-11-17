/** Reading omits the footer; globals.css excludes hidden retained routes (#2383). */
export function HidePublicFooter() {
  return <span hidden data-hide-public-footer-marker="" />;
}
