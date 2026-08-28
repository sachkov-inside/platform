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
}

const StorybookLink = forwardRef<HTMLAnchorElement, StorybookLinkProps>(
  ({ prefetch: _prefetch, ...props }, ref) => <a ref={ref} {...props} />,
);

StorybookLink.displayName = "StorybookLink";

export default StorybookLink;
