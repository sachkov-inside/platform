"use client";

import { Menu } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { FullLoadLink } from "@/shared/ui/full-load-link.client";
import "./authoring-shell.css";

const groups: readonly {
  readonly label: string;
  readonly links: readonly { readonly href: Route; readonly label: string }[];
}[] = [
  {
    label: "Контент",
    links: [
      { href: "/authoring/products", label: "Продукты" },
      { href: "/authoring/materials", label: "Материалы" },
      { href: "/authoring/topics", label: "Темы" },
    ],
  },
  {
    label: "Управление",
    links: [
      { href: "/authoring/submissions", label: "Сдачи" },
      { href: "/authoring/access", label: "Люди и доступ" },
      { href: "/authoring/billing", label: "Продажи и платежи" },
      { href: "/authoring/sales-funnel", label: "Воронка продаж" },
    ],
  },
];

export function AuthoringShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  // A retained shell closes its mobile navigation when the destination changes.
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }
  const currentPath = pathname.endsWith("/preview")
    ? ""
    : pathname.startsWith("/authoring/playlists")
      ? "/authoring/products"
      : pathname;
  const currentLabel =
    groups
      .flatMap((group) => group.links)
      .find((link) => currentPath.startsWith(link.href))?.label ?? "Редактор";

  function navigation() {
    return (
      <>
        {groups.map((group) => (
          <div className="authoring-nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={
                  currentPath.startsWith(link.href) ? "page" : undefined
                }
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
        {pathname.endsWith("/preview") ? (
          <p className="authoring-preview-note" aria-current="page">
            Предпросмотр черновика
          </p>
        ) : null}
        <div className="authoring-public-links">
          <FullLoadLink href="/">Библиотека материалов</FullLoadLink>
          <FullLoadLink href="/">На публичный сайт</FullLoadLink>
        </div>
      </>
    );
  }

  return (
    <div className="authoring-workspace" data-authoring-shell>
      <a className="authoring-skip" href="#authoring-content">
        Перейти к содержанию
      </a>
      <aside className="authoring-sidebar" aria-label="Редактор">
        <Link className="authoring-brand" href="/authoring/products">
          <span className="authoring-brand-mark" aria-hidden="true">
            s.
          </span>
          <span>
            Sachkov Dev
            <span className="authoring-brand-caption">
              Рабочее пространство
            </span>
          </span>
        </Link>
        <nav aria-label="Редактор">{navigation()}</nav>
      </aside>
      <div className="authoring-main">
        <header className="authoring-mobile-bar">
          <Link className="authoring-mobile-brand" href="/authoring/products">
            Sachkov Dev
          </Link>
          <button
            className="authoring-menu-trigger"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="authoring-mobile-menu"
            onClick={() => {
              setMenuOpen(!menuOpen);
            }}
          >
            <Menu size={18} aria-hidden="true" />
            {menuOpen ? "Закрыть меню" : "Меню"}
          </button>
        </header>
        {menuOpen ? (
          <nav
            className="authoring-mobile-menu"
            id="authoring-mobile-menu"
            aria-label="Редактор на мобильном"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenuOpen(false);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(".authoring-menu-trigger")
                  ?.focus();
              }
            }}
          >
            <p className="authoring-current-section">{currentLabel}</p>
            {navigation()}
          </nav>
        ) : null}
        {children}
      </div>
    </div>
  );
}
