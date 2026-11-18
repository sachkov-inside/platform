"use client";

import { type ReactNode, useCallback, useState } from "react";

import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";

/** Repeat the return action after scrolling past its ordinary, non-sticky top position. */
export function ReaderReturnNavigation({
  children,
  repeatAtBottom,
  hideReturn = false,
  topNavigation,
  target,
}: {
  readonly children: ReactNode;
  readonly repeatAtBottom: boolean;
  readonly hideReturn?: boolean;
  readonly topNavigation?: ReactNode;
  readonly target: MaterialReaderReturnTarget;
}) {
  const [topOutsideViewport, setTopOutsideViewport] = useState(false);
  const observeTop = useCallback(
    (top: HTMLDivElement | null) => {
      if (top === null || !repeatAtBottom) return;
      const observer = new IntersectionObserver((entries) => {
        const latestEntry = entries.at(-1);
        if (latestEntry !== undefined)
          setTopOutsideViewport(!latestEntry.isIntersecting);
      });
      observer.observe(top);
      return () => {
        observer.disconnect();
      };
    },
    [repeatAtBottom],
  );

  if (hideReturn && topNavigation === undefined) return children;

  const action = <CatalogBackLink href={target.href} label={target.label} />;

  return (
    <>
      <div
        className="mx-auto mb-6 max-w-[43rem]"
        data-reader-return={hideReturn ? undefined : "top"}
        data-reader-top-frame
        ref={observeTop}
      >
        {topNavigation ?? action}
      </div>
      {children}
      {repeatAtBottom && topOutsideViewport ? (
        <div className="mx-auto mt-8 max-w-[43rem]" data-reader-return="bottom">
          {action}
        </div>
      ) : null}
    </>
  );
}
