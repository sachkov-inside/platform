"use client";

import {
  CircleUserRound,
  UserRound,
  LogIn,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";

export type AuthControlState = "authenticated" | "guest" | "unavailable";

interface AuthControlStateProps {
  readonly state: AuthControlState;
  readonly avatar?: ReactNode;
}

const triggerClass =
  "relative inline-flex min-h-9 max-w-full items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-xs before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] font-semibold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none";
const menuItemClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium no-underline outline-none hover:bg-muted focus:bg-muted data-[highlighted]:bg-muted";

/** Header identity actions; state remains owned by the app adapter. */
export function HeaderAuthControl({ state, avatar }: AuthControlStateProps) {
  if (state === "guest")
    return (
      <form
        action="/auth/sign-in"
        method="post"
        className="flex min-h-11 items-center"
      >
        <button
          type="submit"
          aria-label="Войти через Telegram"
          className={triggerClass}
        >
          <span>
            Войти<span className="hidden lg:inline"> через Telegram</span>
          </span>
          <LogIn
            aria-hidden="true"
            className="hidden size-3.5 shrink-0 sm:block"
          />
        </button>
      </form>
    );

  const authenticated = state === "authenticated";
  const Icon = authenticated ? UserRound : ShieldAlert;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={authenticated ? "Аккаунт" : "Сессия"}
        title={authenticated ? "Аккаунт" : "Сессия"}
        className="inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-foreground transition-colors hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        {authenticated && avatar != null ? (
          avatar
        ) : (
          <Icon aria-hidden="true" className="size-6" />
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-public-shell
          align="end"
          sideOffset={8}
          className="z-50 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background p-2 text-foreground shadow-floating-nav"
        >
          {authenticated ? (
            <DropdownMenu.Item asChild>
              <Link href="/account" className={menuItemClass}>
                <CircleUserRound aria-hidden="true" className="size-5" />
                Личный кабинет
              </Link>
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Label className="block px-3 py-2 text-sm font-normal leading-6 text-muted-foreground">
              Статус входа недоступен. Завершите сессию, чтобы войти заново.
            </DropdownMenu.Label>
          )}
          <form action="/auth/sign-out" method="post">
            <DropdownMenu.Item
              asChild
              onSelect={(event) => {
                event.preventDefault();
              }}
            >
              <button type="submit" className={menuItemClass}>
                <LogOut aria-hidden="true" className="size-5" />
                {authenticated ? "Выйти" : "Завершить сессию"}
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
