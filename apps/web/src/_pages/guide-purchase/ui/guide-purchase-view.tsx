import type { ReactNode } from "react";
import Link from "next/link";

import {
  billingActionClass,
  OfferCard,
  formatKopecks,
  type PriceSnapshot,
} from "@/entities/subscription";
import { internalRoute } from "@/shared/routing/internal-route";
import { guidePurchaseHref } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

/** Кто смотрит витрину: это решает, показывать оформление или приглашение войти. */
export type GuidePurchaseViewer = "loading" | "guest" | "member";

export interface GuidePurchaseViewProps {
  readonly guide: { readonly name: string; readonly summary: string } | null;
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
  readonly viewer: GuidePurchaseViewer;
  /** Цену не удалось прочитать: это временный сбой, а не «не продаётся». */
  readonly unavailable?: boolean;
  readonly notice?: string | undefined;
  /** Оформление покупки участника: витрина сама его не собирает. */
  readonly children?: ReactNode;
}

/**
 * Витрина одного руководства. Руководство продаётся, только когда владелец завёл ему цену,
 * поэтому отсутствие предложения здесь — обычное состояние, а не ошибка. Подписка на эту
 * страницу не влияет: её можно не включать вовсе.
 */
export function GuidePurchaseView({
  guide,
  offer,
  slug,
  viewer,
  unavailable = false,
  notice,
  children,
}: GuidePurchaseViewProps) {
  const guideHref = internalRoute(`/guides/${encodeURIComponent(slug)}`);

  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <header className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Покупка руководства
        </p>
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          {guide?.name ?? "Руководство"}
        </h1>
        {guide === null || guide.summary === "" ? null : (
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {guide.summary}
          </p>
        )}
        <p className="text-sm">
          <Link
            className="text-action underline underline-offset-4"
            href={guideHref}
          >
            Вернуться к руководству
          </Link>
        </p>
      </header>

      {unavailable ? (
        <p
          className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
          role="status"
        >
          Цена сейчас недоступна. Обновите страницу позже — цены и состав
          приходят с сервера.
        </p>
      ) : offer === null ? (
        <p
          className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
          role="status"
        >
          Это руководство сейчас не продаётся отдельно.
        </p>
      ) : viewer === "loading" ? (
        <p className="text-sm text-muted-foreground" role="status">
          Проверяем ваши покупки…
        </p>
      ) : viewer === "guest" ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-xl font-semibold">Войдите, чтобы купить</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            После входа вы вернётесь сюда и продолжите покупку за{" "}
            {formatKopecks(offer.firstPriceKopecks)}.
          </p>
          <form action="/auth/sign-in" className="mt-4" method="post">
            <input name="returnTo" type="hidden" value={guidePurchaseHref(slug)} />
            <Button className={billingActionClass} type="submit">
              Войти
            </Button>
          </form>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <OfferCard headingLevel="h2" snapshot={offer} />
          {children}
        </div>
      )}

      {notice === undefined ? null : (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
