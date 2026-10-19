"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Minus, Plus, type LucideIcon } from "lucide-react";

/** Account settings row with an accessible Radix disclosure and explicit action icon. */
export function AccountDisclosure({
  children,
  description,
  icon: Icon,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly id: string;
  readonly title: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
    };
  }, [id]);

  return (
    <Collapsible.Root
      className="border-b border-border py-2"
      id={id}
      onOpenChange={setOpen}
      open={open}
    >
      <Collapsible.Trigger className="group flex min-h-16 w-full items-center gap-4 rounded-xl px-3 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Icon
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{title}</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {description}
          </span>
        </span>
        {open ? (
          <Minus
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground sm:size-5"
          />
        ) : (
          <Plus
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground sm:size-5"
          />
        )}
      </Collapsible.Trigger>
      <Collapsible.Content
        forceMount
        className="data-[state=closed]:hidden px-3 pb-4 pt-2"
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
