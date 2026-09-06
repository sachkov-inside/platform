"use client";

import { CircleUserRound, LogIn, LogOut, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";

export type AuthControlState = "authenticated" | "guest" | "unavailable";

interface AuthControlStateProps {
  readonly state: AuthControlState;
}

const triggerClass =
  "inline-flex min-h-11 w-[6.5rem] items-center justify-center gap-2 rounded-full bg-primary px-3 text-[0.8125rem] font-semibold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none";
const menuItemClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium no-underline outline-none hover:bg-muted focus:bg-muted data-[highlighted]:bg-muted";

/** Same identity actions at every viewport; state remains owned by the app adapter. */
export function HeaderAuthControl({ state }: AuthControlStateProps) {
  if (state === "guest")
    return (
      <form action="/auth/sign-in" method="post">
        <button type="submit" className={triggerClass}>
          Войти
          <LogIn
            aria-hidden="true"
            className="hidden size-4 shrink-0 sm:block"
          />
        </button>
      </form>
    );

  const authenticated = state === "authenticated";
  const Icon = authenticated ? CircleUserRound : ShieldAlert;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={triggerClass}>
        {authenticated ? "Аккаунт" : "Сессия"}
        <Icon aria-hidden="true" className="hidden size-4 shrink-0 sm:block" />
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
                Профиль
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
