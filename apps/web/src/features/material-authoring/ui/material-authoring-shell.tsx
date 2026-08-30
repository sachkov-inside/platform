import { Eye, FilePlus2, Globe2, LibraryBig, PenLine } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export function MaterialAuthoringShell({
  children,
  current,
}: {
  readonly children: ReactNode;
  readonly current: "create" | "preview";
}) {
  return (
    <div className="min-h-svh bg-background text-foreground md:flex md:h-svh md:min-h-0 md:overflow-hidden">
      <a
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-transform focus:translate-y-0 motion-reduce:transition-none"
        href="#authoring-content"
      >
        Перейти к содержанию
      </a>
      <aside aria-label="Authoring" className="hidden w-56 shrink-0 bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
          <Link
            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sidebar-foreground no-underline"
            href="/authoring/materials/new"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <PenLine aria-hidden="true" className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Inside Authoring</span>
              <span className="block font-mono text-xs text-sidebar-foreground/60">
                рабочее пространство
              </span>
            </span>
          </Link>

          <nav aria-label="Authoring" className="mt-7 grid gap-1">
            <AuthoringLink
              current={current === "create"}
              href="/authoring/materials/new"
              icon={<FilePlus2 aria-hidden="true" />}
              label="Новый материал"
            />
            {current === "preview" ? (
              <div
                aria-current="page"
                className="flex min-h-11 items-center gap-3 rounded-xl bg-sidebar-accent px-3 text-sm font-medium text-sidebar-accent-foreground"
              >
                <Eye aria-hidden="true" className="size-5 text-sidebar-primary" />
                <span>Preview черновика</span>
              </div>
            ) : null}
            <AuthoringLink
              href="/library"
              icon={<LibraryBig aria-hidden="true" />}
              label="Публичная библиотека"
            />
          </nav>

          <div className="mt-auto border-t border-sidebar-border pt-3">
            <AuthoringLink
              href="/"
              icon={<Globe2 aria-hidden="true" />}
              label="На публичный сайт"
            />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:h-full md:pb-0">
        {children}
      </div>

      <nav
        aria-label="Authoring на мобильном"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="grid grid-cols-3 px-2 pt-1">
          <MobileLink current={current === "create"} href="/authoring/materials/new" label={current === "preview" ? "Редактор" : "Создать"}>
            {current === "preview" ? <PenLine aria-hidden="true" /> : <FilePlus2 aria-hidden="true" />}
          </MobileLink>
          <MobileLink href="/library" label="Библиотека">
            <LibraryBig aria-hidden="true" />
          </MobileLink>
          <MobileLink href="/" label="Сайт">
            <Globe2 aria-hidden="true" />
          </MobileLink>
        </div>
      </nav>
    </div>
  );
}

function AuthoringLink({
  current = false,
  href,
  icon,
  label,
}: {
  readonly current?: boolean;
  readonly href: "/" | "/authoring/materials/new" | "/library";
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/72 no-underline transition-colors motion-reduce:transition-none",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        current && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      href={href}
    >
      <span className={cn("[&_svg]:size-5", current && "text-sidebar-primary")}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function MobileLink({
  children,
  current = false,
  href,
  label,
}: {
  readonly children: ReactNode;
  readonly current?: boolean;
  readonly href: "/" | "/authoring/materials/new" | "/library";
  readonly label: string;
}) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-xs font-medium leading-none text-muted-foreground no-underline",
        "transition-colors active:bg-muted motion-reduce:transition-none [&_svg]:size-4.5",
        current && "text-foreground [&_svg]:text-accent",
      )}
      href={href}
    >
      {children}
      <span>{label}</span>
    </Link>
  );
}
