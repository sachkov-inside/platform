import { ArrowUpRight, FileText, Play } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { materialReaderHref } from "@/shared/routing/material-reader";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import type { ContinueMaterialView, PersonalHomeView } from "../model/personal-home-view";

export function ContinueLearning({ view, readingActions, onRetry }: {
  readonly view: PersonalHomeView;
  readonly readingActions?: ReadonlyMap<string, ReactNode>;
  readonly onRetry?: () => void;
}) {
  if (view.kind === "hidden") return null;
  const content = view.kind === "loading" ? view.previous : view;
  return (
    <section aria-labelledby="home-continue" aria-busy={view.kind === "loading"} className="relative mb-10 md:mb-12" data-personal-home-state={view.kind}>
      {view.kind === "loading" ? <span className="absolute right-0 top-0 rounded-full bg-background px-3 py-1 text-xs text-muted-foreground" role="status">Обновляем…</span> : null}
      <PublicSectionHeading className="mt-2" id="home-continue" title="Продолжить изучение" />
      {content.kind === "ready" && content.items.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">Здесь появятся материалы, которые вы откроете и ещё не отметите изученными.</p>
      ) : content.kind === "ready" ? (
        <ul aria-label="Незавершённые материалы" className="mt-4 grid gap-3 md:grid-cols-2" role="list">
          {content.items.map((item) => <li key={item.id}><ContinueCard item={item} readingAction={readingActions?.get(item.id)} /></li>)}
        </ul>
      ) : (
        <div className="mt-4 rounded-2xl bg-muted px-5 py-4">
          <p className="text-sm leading-6 text-muted-foreground" role="status">Не удалось загрузить ваши материалы. База знаний и руководства доступны ниже.</p>
          {onRetry === undefined ? null : <Button className="mt-2" onClick={onRetry} size="sm" variant="outline">Попробовать ещё раз</Button>}
        </div>
      )}
    </section>
  );
}

function ContinueCard({ item, readingAction }: { readonly item: ContinueMaterialView; readonly readingAction: ReactNode }) {
  const video = item.resume.kind !== "start" || item.format === "Видео";
  const Icon = video ? Play : FileText;
  return (
    <article className="flex h-full min-h-40 flex-col rounded-2xl border border-border bg-card p-4" data-continue-material={item.id}>
      <Link className="group flex flex-1 gap-3 text-foreground no-underline focus-visible:rounded-lg focus-visible:outline-ring" href={materialReaderHref(item.slug, "/")}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Icon aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <span className="text-xs text-muted-foreground">{item.format}</span>
          <h3 className="mt-1 text-base font-semibold leading-6 group-hover:text-action">{item.title}</h3>
          <span className="mt-3 inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-action">
            {item.resume.kind === "position" ? `Продолжить с ${timecode(item.resume.positionSeconds)}` : "Открыть материал"}
            <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
          </span>
        </div>
      </Link>
      {item.resume.kind === "reached-end" ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs leading-5 text-muted-foreground">Видео просмотрено до конца — можно отметить материал</p>
          <div className="mt-1 min-h-11">{readingAction}</div>
        </div>
      ) : null}
    </article>
  );
}

function timecode(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${remainder}` : `${String(minutes)}:${remainder}`;
}
