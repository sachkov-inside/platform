"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/", label: "Главная" },
  { href: "/library", label: "Библиотека" },
  { href: "/map", label: "Карта" },
] as const;

export function GlobalNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная" className="primary-navigation">
      <ul className="primary-navigation__list" role="list">
        {destinations.map((destination) => {
          const current = isCurrentDestination(pathname, destination.href);

          return (
            <li key={destination.href}>
              <Link
                aria-current={current ? "page" : undefined}
                className="primary-navigation__link"
                href={destination.href}
              >
                {destination.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function isCurrentDestination(pathname: string, href: (typeof destinations)[number]["href"]): boolean {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
