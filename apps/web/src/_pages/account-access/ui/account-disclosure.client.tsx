"use client";

import type { ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Minus, Plus, type LucideIcon } from "lucide-react";

import { useAccountDisclosure } from "../model/use-account-disclosure.client";

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
  const { open, setOpen } = useAccountDisclosure(id);

  return (
    <Collapsible.Root
      className="rounded-xl bg-muted/40"
      id={id}
      onOpenChange={setOpen}
      open={open}
    >
      <Collapsible.Trigger className="group flex min-h-16 w-full items-center gap-4 rounded-xl px-4 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
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
        className="data-[state=closed]:hidden px-4 pb-5 pt-1"
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
