import { Eye, Files, FilePlus2, Globe2, LibraryBig, ListOrdered, PenLine } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import { authoringMaterialsRootHref } from "../model/authoring-return";

export function MaterialAuthoringShell({
  children,
  createHref = "/authoring/materials/new",
  current,
}: {
  readonly children: ReactNode;
  readonly createHref?: Route;
  readonly current: "create" | "materials" | "playlists" | "preview";
}) {
  return (
    <div className="min-h-svh bg-background text-foreground md:flex md:h-svh md:min-h-0 md:overflow-hidden">
      <a
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-transform focus:translate-y-0 motion-reduce:transition-none"
        href="#authoring-content"
      >
        Перейти к содержанию
      </a>
      <aside aria-label="Редактор" className="hidden w-56 shrink-0 bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
          <Link
            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sidebar-foreground no-underline"
            href={authoringMaterialsRootHref}
          >
            <span className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <PenLine aria-hidden="true" className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Редактор Inside</span>
              <span className="block font-mono text-xs text-sidebar-foreground/60">
                рабочее пространство
              </span>
            </span>
          </Link>

          <nav aria-label="Редактор" className="mt-7 grid gap-1">
            <AuthoringLink
              current={current === "materials"}
              href={authoringMaterialsRootHref}
              icon={<Files aria-hidden="true" />}
              label="Материалы"
            />
            <AuthoringLink
              current={current === "create"}
              href={createHref}
              icon={<FilePlus2 aria-hidden="true" />}
              label="Новый материал"
            />
            <AuthoringLink
              current={current === "playlists"}
              href="/authoring/playlists"
              icon={<ListOrdered aria-hidden="true" />}
              label="Плейлисты"
            />
            {current === "preview" ? (
              <div
                aria-current="page"
                className="flex min-h-11 items-center gap-3 rounded-xl bg-sidebar-accent px-3 text-sm font-medium text-sidebar-accent-foreground"
              >
                <Eye aria-hidden="true" className="size-5 text-sidebar-primary" />
                <span>Предпросмотр черновика</span>
              </div>
            ) : null}
            <AuthoringLink
              href="/library"
              icon={<LibraryBig aria-hidden="true" />}
              label="База знаний"
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
        aria-label="Редактор на мобильном"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="grid grid-cols-4 px-2 pt-1">
          <MobileLink current={current === "materials"} href={authoringMaterialsRootHref} label="Материалы">
            <Files aria-hidden="true" />
          </MobileLink>
          <MobileLink current={current === "playlists"} href="/authoring/playlists" label="Плейлисты">
            <ListOrdered aria-hidden="true" />
          </MobileLink>
          <MobileLink href="/library" label="База знаний">
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
  readonly href: Route;
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
  readonly href: Route;
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
