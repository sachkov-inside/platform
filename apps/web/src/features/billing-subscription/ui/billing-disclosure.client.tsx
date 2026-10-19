"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Collapsible } from "radix-ui";
import { Minus, Plus } from "lucide-react";

/** Compact disclosure for secondary billing information, consistent with cabinet rows. */
export function BillingDisclosure({
  children,
  title,
  tone = "default",
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly tone?: "default" | "inverse";
}) {
  return (
    <Collapsible.Root className="group/billing mt-4 text-sm leading-6">
      <Collapsible.Trigger
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          tone === "inverse"
            ? "text-primary-foreground/80 hover:bg-primary-foreground/10 focus-visible:outline-primary-foreground"
            : "hover:bg-muted focus-visible:outline-ring",
        )}
      >
        <span>{title}</span>
        <Plus
          aria-hidden="true"
          className="size-4 shrink-0 text-current group-data-[state=open]/billing:hidden"
        />
        <Minus
          aria-hidden="true"
          className="hidden size-4 shrink-0 text-current group-data-[state=open]/billing:block"
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
