import { ArrowRight, Check, FileDown, Play, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ContentCoverImage } from "@/entities/material";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import {
  formatMaterialCount,
  type PublishedSeriesResult,
} from "@/features/library-discovery";
import { cn } from "@/shared/lib/utils";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

type ResolvedSeriesResult = Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;

/**
 * Страница продукта руководства: она отвечает, о чём это, кому, что получится и что остаётся за
 * границами. Материалы, состояния доступа и цена живут на странице программы, поэтому отсюда
 * ведёт одно действие — «Открыть программу». Ненаписанное поле не показывается, поэтому частично
 * готовое руководство не выглядит завершённым.
 */
export function GuideProductView({
  artifacts = { kind: "ready", artifacts: [] },
  result,
  freeEntryHref,
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedSeriesResult;
  /** Первый открытый материал: бесплатный вход из обложки. */
  readonly freeEntryHref?: Route;
}) {
  const { reference } = result;
  const introduction = reference.introduction ?? null;
  const items = result.kind === "ready" ? result.items : [];
  const chapters = result.chapters;
  const guideArtifacts = artifacts.kind === "ready" ? artifacts.artifacts : [];
  const meta = [
    formatMaterialCount(items.length),
    chapters.length === 0 ? undefined : `${String(chapters.length)} ${chapterWord(chapters.length)}`,
    guideArtifacts.length === 0 ? undefined : `${String(guideArtifacts.length)} ${artifactWord(guideArtifacts.length)}`,
  ].filter((value): value is string => value !== undefined);

  return (
    <div className="min-w-0" data-guide-product={reference.slug}>
      <div className="mx-auto w-full min-w-0 max-w-[46rem]">
        <header className="mt-5 overflow-hidden rounded-[1.75rem] bg-primary p-4 text-white">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">
            Руководство
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl">
            <ContentCoverImage
              alt=""
              className="aspect-[16/9] min-h-0 w-full"
              cover={reference.cover ?? null}
              fallbackKind="playlist"
              fallbackSeed={reference.slug}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm tabular-nums text-white/70">
              {formatMaterialCount(items.length)}
            </p>
            {freeEntryHref === undefined ? null : (
              <Button
                asChild
                className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-0 bg-white/15 text-white hover:bg-white/25 hover:text-white"
                variant="outline"
              >
                <Link href={freeEntryHref}>
                  <Play aria-hidden="true" className="size-4 shrink-0" />
                  Попробовать бесплатно
                </Link>
              </Button>
            )}
          </div>
        </header>

        <h1 className="mt-7 break-words text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.035em] md:text-4xl">
          {reference.name}
        </h1>
        {reference.summary === "" ? null : (
          <p className="mt-3 break-words text-base leading-7 text-muted-foreground md:text-lg">
            {reference.summary}
          </p>
        )}
        {meta.length === 0 ? null : (
          <p className="mt-3 text-sm text-muted-foreground">{meta.join(" · ")}</p>
        )}

        {introduction === null || introduction.audience === "" ? null : (
          <Section title="Кому это нужно">
            <Prose value={introduction.audience} />
          </Section>
        )}

        {introduction === null || introduction.outcome === "" ? null : (
          <Section title="Что получается">
            <Prose value={introduction.outcome} />
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Это то, что останется у вас в проекте после прохождения.
            </p>
          </Section>
        )}

        {chapters.length === 0 ? null : (
          <Section title="Что внутри руководства">
            <p className="text-sm leading-6 text-muted-foreground">
              <span className="font-semibold text-foreground">
                {formatMaterialCount(items.length)}
              </span>
              . Вот основные темы.
            </p>
            <ol className="mt-5 grid gap-5">
              {chapters.map((chapter, index) => (
                <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={chapter.id}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-8 place-items-center rounded-xl text-sm font-semibold tabular-nums",
                      chapterTone(index),
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words font-semibold leading-6">{chapter.name}</p>
                    {chapter.summary === "" ? null : (
                      <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">
                        {chapter.summary}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {introduction === null || introduction.prerequisites === "" ? null : (
          <Section title="Как это работает">
            <div className="rounded-2xl bg-muted p-5">
              <p className="flex items-center gap-2 font-semibold">
                <Check aria-hidden="true" className="size-5 shrink-0 text-accent" />
                Что понадобится
              </p>
              <div className="mt-3">
                <Prose value={introduction.prerequisites} />
              </div>
            </div>
          </Section>
        )}

        {guideArtifacts.length === 0 ? null : (
          <Section title="Что останется в проекте">
            <ul className="grid gap-3">
              {guideArtifacts.map((artifact) => (
                <li
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 rounded-2xl border border-border p-4"
                  key={artifact.artifactId}
                >
                  <FileDown aria-hidden="true" className="mt-0.5 size-5 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="break-words font-semibold leading-6">{artifact.title}</p>
                    {artifact.purpose === "" ? null : (
                      <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
                        {artifact.purpose}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {introduction === null || introduction.scope === "" ? null : (
          <Section title="Что остаётся за границами">
            <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 rounded-2xl border border-border p-5">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 text-muted-foreground" />
              <Prose value={introduction.scope} />
            </div>
          </Section>
        )}
      </div>

      {/* Липкая, а не фиксированная: панель держится за то, что её прокручивает, и на узком экране
          останавливается над плавающим меню оболочки, а не уходит под него. */}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 mt-10 lg:bottom-4">
        <div className="mx-auto w-full max-w-[46rem] rounded-2xl border border-border bg-background/95 p-2.5 shadow-card backdrop-blur">
          <Button asChild className="h-auto min-h-11 w-full whitespace-normal" size="lg">
            <Link href={guideProgrammeHref(reference.slug)}>
              Открыть программу
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="break-words text-xl font-semibold tracking-[-0.02em] md:text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Авторский текст показывается как написан: переносы строк автора остаются абзацами. */
function Prose({ value }: { readonly value: string }) {
  return (
    <p className="whitespace-pre-line break-words text-sm leading-6 md:text-base md:leading-7">
      {value}
    </p>
  );
}

/** Номер главы окрашен своим тоном по кругу: он отличает главы, но ничего о них не утверждает. */
const chapterTones = [
  "bg-cover-sand",
  "bg-cover-blue",
  "bg-cover-mint",
  "bg-cover-lavender",
  "bg-cover-coral",
] as const;
function chapterTone(index: number): string {
  return `${chapterTones[index % chapterTones.length] ?? "bg-secondary"} text-foreground`;
}

function chapterWord(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail > 10 && tail < 20) return "глав";
  if (last === 1) return "глава";
  if (last > 1 && last < 5) return "главы";
  return "глав";
}

function artifactWord(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail > 10 && tail < 20) return "артефактов";
  if (last === 1) return "артефакт";
  if (last > 1 && last < 5) return "артефакта";
  return "артефактов";
}
