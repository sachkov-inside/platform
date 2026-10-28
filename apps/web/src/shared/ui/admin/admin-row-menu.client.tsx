"use client";

import { Ellipsis } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRef } from "react";
import { DropdownMenu } from "radix-ui";

import { cn } from "@/shared/lib/utils";

import "./admin.css";

export interface AdminRowMenuItem {
  readonly id: string;
  readonly label: string;
  /** Действие. Вызывается после того, как меню закрылось и фокус вернулся на «⋯». */
  readonly onSelect?: () => void;
  /** Переход вместо действия. */
  readonly href?: Route;
  readonly tone?: "default" | "danger";
  readonly disabled?: boolean;
}

const itemClass =
  "flex min-h-10 w-full cursor-default select-none items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-muted pointer-coarse:min-h-11";
const dangerItemClass =
  "text-destructive data-[highlighted]:bg-[color-mix(in_oklch,var(--destructive)_9%,var(--popover))] data-[highlighted]:text-destructive";

/**
 * Меню редких действий строки: всегда видимая кнопка «⋯», а не меню по наведению. Действие пункта
 * запускается после закрытия меню, когда фокус уже вернулся на «⋯»: открытый им диалог потом
 * вернёт фокус туда же.
 */
export function AdminRowMenu({
  label,
  items,
}: {
  /** Имя кнопки с названием строки: «Действия с «Название»». */
  readonly label: string;
  readonly items: readonly AdminRowMenuItem[];
}) {
  const pendingAction = useRef<(() => void) | null>(null);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        className="admin-row-menu-trigger"
        data-row-action=""
        title={label}
        type="button"
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-[70] min-w-48 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-card data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none"
          collisionPadding={8}
          onCloseAutoFocus={() => {
            const action = pendingAction.current;
            pendingAction.current = null;
            // Radix сейчас вернёт фокус на «⋯»; действие идёт следом, чтобы диалог запомнил её.
            if (action !== null) window.setTimeout(action, 0);
          }}
          sideOffset={4}
        >
          {items.map((item) => {
            const className = cn(
              itemClass,
              item.tone === "danger" && dangerItemClass,
            );
            if (item.href !== undefined)
              return (
                <DropdownMenu.Item
                  asChild
                  disabled={item.disabled === true}
                  key={item.id}
                >
                  <Link className={className} href={item.href}>
                    {item.label}
                  </Link>
                </DropdownMenu.Item>
              );
            return (
              <DropdownMenu.Item
                className={className}
                disabled={item.disabled === true}
                key={item.id}
                onSelect={() => {
                  pendingAction.current = item.onSelect ?? null;
                }}
              >
                {item.label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
