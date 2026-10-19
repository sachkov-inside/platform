"use client";

import type { ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Minus, Plus } from "lucide-react";

/** Compact disclosure for secondary billing information, consistent with cabinet rows. */
export function BillingDisclosure({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <Collapsible.Root className="group/billing mt-4 text-sm leading-6">
      <Collapsible.Trigger className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <span>{title}</span>
        <Plus
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-data-[state=open]/billing:hidden"
        />
        <Minus
          aria-hidden="true"
          className="hidden size-4 shrink-0 text-muted-foreground group-data-[state=open]/billing:block"
        />
      </Collapsible.Trigger>
      <Collapsible.Content
        forceMount
        className="data-[state=closed]:hidden px-2 pt-2"
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
