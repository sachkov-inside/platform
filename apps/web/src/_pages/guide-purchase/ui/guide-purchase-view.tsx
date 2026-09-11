import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import {
  billingActionClass,
  formatKopecks,
  type PriceSnapshot,
} from "@/entities/subscription";
import { internalRoute } from "@/shared/routing/internal-route";
import { guidePurchaseHref } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

/** Кто смотрит страницу оплаты: это решает, показывать оформление или приглашение войти. */
export type GuidePurchaseViewer = "loading" | "guest" | "member";

export interface GuidePurchaseViewProps {
  readonly guide: { readonly name: string; readonly summary: string } | null;
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
  readonly viewer: GuidePurchaseViewer;
  /** Цену не удалось прочитать: это временный сбой, а не «не продаётся». */
  readonly unavailable?: boolean;
  readonly notice?: string | undefined;
  /** Оформление покупки участника: страница сама его не собирает. */
  readonly children?: ReactNode;
}

/**
 * Страница оплаты руководства: название, что входит, цена и одна кнопка. Цену читатель видит
 * только здесь — программа лишь приглашает оплатить. Руководство продаётся, только когда
 * владелец завёл ему цену, поэтому отсутствие предложения здесь — обычное состояние.
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
  const programmeHref = internalRoute(
    `/guides/${encodeURIComponent(slug)}/programme`,
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[38rem]">
      <nav aria-label="Путь навигации" className="pt-4">
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold"
          href={programmeHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          Программа
        </Link>
      </nav>

      <h1 className="mt-6 break-words text-[2rem] font-bold leading-[1.1] tracking-[-0.04em] md:text-5xl">
        {guide?.name ?? "Руководство"}
      </h1>
      {guide === null || guide.summary === "" ? null : (
        <p className="mt-4 break-words text-base leading-7 text-muted-foreground md:text-lg">
          {guide.summary}
        </p>
      )}

      <div className="mt-7">
        {unavailable ? (
          <p
            className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
            role="status"
          >
            Цена сейчас недоступна. Обновите страницу позже — цены и состав приходят
            с сервера.
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
              <input
                name="returnTo"
                type="hidden"
                value={guidePurchaseHref(slug)}
              />
              <Button className={billingActionClass} type="submit">
                Войти
              </Button>
            </form>
          </section>
        ) : (
          children
        )}
      </div>

      {notice === undefined ? null : (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
