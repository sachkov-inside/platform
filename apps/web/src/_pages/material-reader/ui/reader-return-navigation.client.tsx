"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { Button } from "@/shared/ui/button";

/** Repeat the return action after scrolling past its ordinary, non-sticky top position. */
export function ReaderReturnNavigation({ children, repeatAtBottom, target }: {
  readonly children: ReactNode;
  readonly repeatAtBottom: boolean;
  readonly target: MaterialReaderReturnTarget;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const [topOutsideViewport, setTopOutsideViewport] = useState(false);

  useEffect(() => {
    const top = topRef.current;
    if (top === null || !repeatAtBottom) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry !== undefined) setTopOutsideViewport(!entry.isIntersecting);
    });
    observer.observe(top);
    return () => { observer.disconnect(); };
  }, [repeatAtBottom]);

  const action = (
    <Button asChild className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-0 bg-black/5 px-4 text-xs font-semibold shadow-none" variant="outline">
      <Link href={target.href}><ArrowLeft aria-hidden="true" />{target.label}</Link>
    </Button>
  );

  return (
    <>
      <div className="mx-auto mb-6 max-w-[43rem]" data-reader-return="top" ref={topRef}>{action}</div>
      {children}
      {repeatAtBottom && topOutsideViewport ? (
        <div className="mx-auto mt-8 max-w-[43rem]" data-reader-return="bottom">{action}</div>
      ) : null}
    </>
  );
}
