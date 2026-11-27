import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

interface FixtureLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  readonly children?: ReactNode;
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly scroll?: boolean | undefined;
  readonly onNavigate?: (() => void) | undefined;
}

const FixtureLink = forwardRef<HTMLAnchorElement, FixtureLinkProps>(
  (
    { prefetch: _prefetch, scroll: _scroll, onNavigate: _onNavigate, ...props },
    ref,
  ) => <a ref={ref} {...props} />,
);

FixtureLink.displayName = "FixtureLink";

export default FixtureLink;

export function useLinkStatus() {
  return { pending: false };
}
