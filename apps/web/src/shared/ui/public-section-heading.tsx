import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export function PublicSectionHeading({
  aside,
  className,
  id,
  title,
}: {
  readonly aside?: ReactNode;
  readonly className?: string;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <div
      className={cn(
        "flex items-end justify-between gap-4",
        className,
      )}
    >
      <h2
        className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl"
        id={id}
      >
        {title}
      </h2>
      {aside}
    </div>
  );
}
