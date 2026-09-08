import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

interface StorybookLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  readonly children?: ReactNode;
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly scroll?: boolean | undefined;
  readonly onNavigate?: (() => void) | undefined;
}

const StorybookLink = forwardRef<HTMLAnchorElement, StorybookLinkProps>(
  ({ prefetch: _prefetch, scroll: _scroll, onNavigate: _onNavigate, ...props }, ref) => <a ref={ref} {...props} />,
);

StorybookLink.displayName = "StorybookLink";

export default StorybookLink;

export function useLinkStatus() { return { pending: false }; }
