import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import "./home-page.css";

/**
 * Каркас главной. Загрузка и готовая страница берут его отсюда, поэтому первый экран остаётся на
 * месте, пока приходят данные: `home-page.css` описывает геометрию и типографику именно этой
 * оболочки, а не отдельные состояния.
 */
export function HomeFrame({
  children,
  membership,
}: {
  readonly children: ReactNode;
  readonly membership?: string;
}) {
  return (
    <div className="home-page @container/home min-w-0" data-home-membership={membership}>
      <h1 className="sr-only">Главная</h1>
      {children}
    </div>
  );
}

/**
 * Руководства открывают первый экран, поэтому секция и её заголовок неразделимы: верхний отступ
 * снимает правило `.home-page section[aria-labelledby=home-series] > .home-section-heading`, и оно
 * находит заголовок только внутри этой секции.
 */
export function HomeSeriesSection({ children }: { readonly children: ReactNode }) {
  return (
    <section aria-labelledby="home-series">
      <HomeSectionHeading
        action="Все руководства"
        className="mt-2"
        href="/library#series-heading"
        id="home-series"
        title="Руководства"
      />
      {children}
    </section>
  );
}

export function HomeSectionHeading({
  action,
  className = "mt-10 md:mt-12",
  href,
  id,
  title,
}: {
  readonly action: string;
  readonly className?: string;
  readonly href: Route;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <PublicSectionHeading
      aside={
        <Link
          aria-label={action}
          className="shrink-0 text-sm font-semibold text-action no-underline"
          href={href}
        >
          {action}
        </Link>
      }
      className={`home-section-heading ${className}`}
      id={id}
      title={title}
    />
  );
}
