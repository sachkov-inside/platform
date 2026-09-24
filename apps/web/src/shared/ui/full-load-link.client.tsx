"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ComponentProps } from "react";

type FullLoadLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onNavigate" | "prefetch"> & {
  readonly href: Route;
};

/**
 * Ссылка, переход по которой — полная загрузка документа, а не переход роутера. Нужна там, где
 * память браузера о посещённых страницах обязана быть отброшена: автор уходит из авторской части на
 * сайт и должен увидеть свою правку, а не страницу, которую браузер помнит с прошлой минуты
 * (ADR 0027).
 */
export function FullLoadLink({ href, ...props }: FullLoadLinkProps) {
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        window.location.assign(href);
      }}
      prefetch={false}
    />
  );
}
