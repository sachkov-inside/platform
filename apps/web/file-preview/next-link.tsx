import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

interface PreviewLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  readonly children?: ReactNode;
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly scroll?: boolean | undefined;
  readonly onNavigate?: (() => void) | undefined;
}

/** The preview has no client router: a link is an ordinary page load of the preview address. */
const PreviewLink = forwardRef<HTMLAnchorElement, PreviewLinkProps>(
  (
    { prefetch: _prefetch, scroll: _scroll, onNavigate: _onNavigate, ...props },
    ref,
  ) => <a ref={ref} {...props} />,
);

PreviewLink.displayName = "PreviewLink";

export default PreviewLink;

export function useLinkStatus() {
  return { pending: false };
}
