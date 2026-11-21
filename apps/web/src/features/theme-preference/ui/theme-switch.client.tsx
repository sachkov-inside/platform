"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useSyncExternalStore } from "react";

import { cn } from "@/shared/lib/utils";
import {
  parseThemePreference,
  themePreferenceLabels,
  themePreferences,
  type ThemePreference,
} from "../model/theme-preference";
import {
  chooseThemePreference,
  readThemePreference,
  subscribeThemePreference,
} from "./theme-preference.browser";

const iconByPreference: Readonly<Record<ThemePreference, LucideIcon>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const menuItemClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium outline-none hover:bg-muted focus:bg-muted data-[highlighted]:bg-muted";

export interface ThemeSwitchProps {
  /**
   * The menu opens in a portal outside the shell, so it names the surface whose tokens it wears:
   * the public shell or the authoring workspace.
   */
  readonly surface: "public" | "authoring";
  readonly className?: string;
}

/**
 * The header button that chooses the colour theme. The icon follows the class the restore script
 * already put on `<html>`, so it is right before hydration; the menu marks the stored choice.
 */
export function ThemeSwitch({ surface, className }: ThemeSwitchProps) {
  // The choice is a browser fact: the server render and hydration know no choice yet.
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    readThemePreference,
    () => null,
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label="Тема оформления"
        title="Тема оформления"
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:bg-muted motion-reduce:transition-none",
          className,
        )}
        data-theme-switch
      >
        <Sun aria-hidden="true" className="size-5 dark:hidden" />
        <Moon aria-hidden="true" className="hidden size-5 dark:block" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...(surface === "public" ? { "data-public-shell": "" } : {})}
          align="end"
          sideOffset={8}
          className="z-50 w-60 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-floating-nav"
        >
          <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
            Тема оформления
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={preference ?? ""}
            onValueChange={(value) => {
              chooseThemePreference(parseThemePreference(value));
            }}
          >
            {themePreferences.map((option) => {
              const Icon = iconByPreference[option];
              return (
                <DropdownMenu.RadioItem
                  className={menuItemClass}
                  key={option}
                  value={option}
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {themePreferenceLabels[option]}
                  <DropdownMenu.ItemIndicator className="ml-auto text-action">
                    <Check aria-hidden="true" className="size-4" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
