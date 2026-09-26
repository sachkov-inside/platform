"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState, type ComponentProps } from "react";

type IntentPrefetchLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "prefetch"
> & {
  readonly href: Route;
};

/**
 * Ссылка на страницу каталога (ADR 0027). Пока человек её не тронул, она ведёт себя как обычный
 * `<Link>`: предзагружает общую оболочку маршрута, одну на все такие ссылки. Намерение — наведение,
 * фокус или касание — повышает её до `prefetch={true}`, и общая часть страницы по этому адресу
 * приходит до нажатия. Сетка карточек поэтому не будит сервер на каждую видимую ссылку. Личная
 * часть страницы некешируема и в предзагрузку не попадает.
 */
export function IntentPrefetchLink({
  onFocus,
  onPointerEnter,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps) {
  const [intended, setIntended] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intended ? true : null}
      onFocus={(event) => {
        setIntended(true);
        onFocus?.(event);
      }}
      onPointerEnter={(event) => {
        setIntended(true);
        onPointerEnter?.(event);
      }}
      onTouchStart={(event) => {
        setIntended(true);
        onTouchStart?.(event);
      }}
    />
  );
}
