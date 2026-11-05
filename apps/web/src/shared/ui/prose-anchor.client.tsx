"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { proseLinkTarget } from "./prose-link";

// The origin is constant for this document. A server render has no browser location.
const subscribe = () => () => {
  // The document origin cannot change, so there is no listener to remove.
};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => undefined;

export function ProseAnchor({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const origin = useSyncExternalStore(subscribe, browserOrigin, serverOrigin);
  return (
    <a className={className} href={href} {...proseLinkTarget(href, origin)}>
      {children}
    </a>
  );
}
