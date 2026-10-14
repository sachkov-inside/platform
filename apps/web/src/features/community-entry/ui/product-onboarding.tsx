import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { JourneyProgress } from "@/shared/ui/journey-progress";
import type { CommunityEntry } from "../model/community-entry";

export function ProductOnboarding({
  productName,
  entry,
  telegramAction,
  firstLessonHref,
  error,
  onRefresh,
}: {
  readonly productName: string;
  readonly entry: CommunityEntry | null;
  readonly telegramAction: ReactNode;
  readonly firstLessonHref: Route | null;
  readonly error: boolean;
  readonly onRefresh: () => void;
}) {
  const current =
    entry?.kind === "link_telegram" ? 0 : entry?.kind === "member" ? 2 : 1;
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 sm:p-7"
      aria-label={`Онбординг продукта «${productName}»`}
    >
      <JourneyProgress
        labels={["Telegram", "Сообщество", "Первый урок"]}
        current={current}
        label="Шаги онбординга"
      />
      <div className="mt-7 border-t border-border pt-6" aria-live="polite">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {entry?.kind === "link_telegram"
            ? "Привяжите Telegram"
            : entry?.kind === "member"
              ? "Начните первый урок"
              : "Вступите в сообщество"}
        </h2>
        {error ? (
          <div className="mt-3" role="alert">
            <p>Не удалось проверить онбординг.</p>
            <Button className="mt-4" type="button" onClick={onRefresh}>
              Попробовать ещё раз
            </Button>
          </div>
        ) : entry === null ? (
          <p className="mt-3" role="status">
            Проверяем доступ к сообществу…
          </p>
        ) : entry.kind === "link_telegram" ? (
          <div className="mt-5">{telegramAction}</div>
        ) : entry.kind === "join" ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              Telegram привязан. Вступите в группу продукта.
            </p>
            <Button asChild className="mt-6 min-h-12 w-full">
              <a href={entry.botUrl} target="_blank" rel="noopener noreferrer">
                Вступить в сообщество
              </a>
            </Button>
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Вступление подтвердит Telegram.
            </p>
          </>
        ) : entry.kind === "member" ? (
          firstLessonHref === null ? (
            <p className="mt-3" role="status">
              Первый урок пока не опубликован.
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Telegram подключён. Вступление подтверждено.
              </p>
              <Button asChild className="mt-6 min-h-12 w-full">
                <Link href={firstLessonHref}>Начать первый урок</Link>
              </Button>
            </>
          )
        ) : (
          <>
            <p className="mt-3 text-sm" role="status">
              {entry.kind === "restricted"
                ? "Вступление ограничено. Обратитесь в поддержку."
                : "Готовим доступ к группе продукта."}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5"
              onClick={onRefresh}
            >
              Проверить состояние
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
