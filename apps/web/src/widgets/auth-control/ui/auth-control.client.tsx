"use client";

import { CircleUserRound, LogIn, LogOut, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { cn } from "@/shared/lib/utils";

export type AuthControlState = "authenticated" | "guest" | "unavailable";

interface AuthControlStateProps {
  readonly accountLabel?: string | undefined;
  readonly state: AuthControlState;
}

const contentByState = {
  authenticated: { action: "/auth/sign-out", Icon: LogOut, label: "Выйти" },
  guest: { action: "/auth/sign-in", Icon: LogIn, label: "Войти" },
  unavailable: {
    action: "/auth/sign-out",
    Icon: ShieldAlert,
    label: "Завершить сессию",
  },
} as const;

export function DesktopAuthControl({ accountLabel, state }: AuthControlStateProps) {
  const { action, Icon, label } = contentByState[state];

  return (
    <div className="grid gap-1">
      {state === "authenticated" ? (
        <DesktopAccountIdentity label={accountLabel ?? "Аккаунт"} />
      ) : null}
      <form action={action} method="post">
        <button
          aria-label={label}
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/72",
            "transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-sidebar-ring motion-reduce:transition-none",
          )}
          type="submit"
        >
          <Icon aria-hidden="true" className="size-5 shrink-0" />
          <span
            aria-hidden="true"
            className={cn(
              "hidden -translate-x-1 whitespace-nowrap opacity-0 transition-[opacity,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none md:inline",
              "group-data-[state=expanded]/sidebar:translate-x-0 group-data-[state=expanded]/sidebar:opacity-100",
            )}
          >
            {label}
          </span>
        </button>
      </form>
    </div>
  );
}

function DesktopAccountIdentity({ label }: { readonly label: string }) {
  return (
    <Link
      aria-label={`Открыть аккаунт: ${label}`}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-sidebar-foreground no-underline transition-colors hover:bg-sidebar-accent focus-visible:outline-sidebar-ring"
      href="/account"
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-primary font-mono text-xs font-bold text-sidebar-primary-foreground"
      >
        {label.trim().slice(0, 1).toLocaleUpperCase("ru")}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "hidden min-w-0 -translate-x-1 truncate opacity-0 transition-[opacity,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none md:inline",
          "group-data-[state=expanded]/sidebar:translate-x-0 group-data-[state=expanded]/sidebar:opacity-100",
        )}
      >
        {label}
      </span>
    </Link>
  );
}

export function MobileAuthControl({ accountLabel, state }: AuthControlStateProps) {
  if (state === "authenticated") {
    return (
      <Link
        aria-label={`Открыть аккаунт: ${accountLabel ?? "Аккаунт"}`}
        className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[0.6875rem] font-medium leading-none text-muted-foreground no-underline transition-colors active:bg-muted focus-visible:outline-ring"
        href="/account"
      >
        <CircleUserRound aria-hidden="true" className="size-4.5" />
        <span className="max-w-full truncate">Аккаунт</span>
      </Link>
    );
  }
  const { action, Icon, label } = contentByState[state];

  return (
    <form action={action} className="min-w-0" method="post">
      <button
        className="flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[0.6875rem] font-medium leading-none text-muted-foreground transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] active:bg-muted focus-visible:outline-ring motion-reduce:transition-none"
        type="submit"
      >
        <Icon aria-hidden="true" className="size-4.5" />
        <span className="max-w-full truncate">{label}</span>
      </button>
    </form>
  );
}
