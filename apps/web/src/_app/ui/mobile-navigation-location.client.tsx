"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect } from "react";

/** Observes in-place filter changes without suspending the persistent application shell. */
export function MobileNavigationLocation({ onChange }: {
  readonly onChange: (pathname: string, search: string) => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useLayoutEffect(() => { onChange(pathname, search); }, [onChange, pathname, search]);
  return null;
}
