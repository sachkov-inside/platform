"use client";

import {
  ArrowRight,
  Boxes,
  Check,
  FileDown,
  Lock,
  MessageCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";

import {
  infrastructureGuide,
  type ShowcaseChapter,
  type ShowcaseGuide,
} from "./guide-showcase.fixtures";

/**
 * Throwaway Storybook prototype of the Guide showcase: the page a visitor sees
 * before the programme. It answers what the Guide is, who it is for and what
 * stays outside, and its one action opens the programme. No price, no checkout
 * and no production data path — those stay owner decisions.
 */
export function GuideShowcasePrototype({
  guide = infrastructureGuide,
  owned = false,
}: {
  readonly guide?: ShowcaseGuide;
  readonly owned?: boolean;
}) {
  const [opened, setOpened] = useState(owned);
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground" data-showcase-state={opened ? "programme" : "showcase"}>
      {opened ? (
        <ProgrammeStub guide={guide} onBack={() => { setOpened(false); }} />
      ) : (
        <Showcase guide={guide} onOpen={() => { setOpened(true); }} />
      )}
    </div>
  );
}

function Showcase({
  guide,
  onOpen,
}: {
  readonly guide: ShowcaseGuide;
  readonly onOpen: () => void;
}) {
  return (
    <>
      <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 pb-10 sm:px-6">
        <Hero guide={guide} onOpen={onOpen} />

        <h1 className="mt-7 break-words text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.035em] md:text-4xl">
          {guide.name}
        </h1>
        <p className="mt-3 break-words text-base leading-7 text-muted-foreground md:text-lg">{guide.pitch}</p>
        <p className="mt-3 text-sm text-muted-foreground">{guide.meta}</p>

        <Section title="Кому это нужно">
          <ul className="grid gap-5">
            {guide.segments.map((segment) => (
              <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3" key={segment.title}>
                <Check aria-hidden="true" className="mt-1 size-5 text-accent" />
                <div className="min-w-0">
                  <p className="break-words font-semibold leading-6">{segment.title}</p>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{segment.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Что получается">
          {/* A horizontally scrollable region has to be reachable by keyboard. */}
          <ul
            aria-label="Что получается после прохождения"
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            tabIndex={0}
          >
            {guide.results.map((result) => (
              <li
                // Enlarged text must not make one card wider than the screen.
                className="flex min-h-44 w-[min(13.5rem,72vw)] shrink-0 snap-start flex-col justify-end rounded-2xl bg-gradient-to-br from-primary to-primary/70 p-4 text-white"
                key={result}
              >
                <Boxes aria-hidden="true" className="mb-auto size-6 opacity-70" />
                <p className="break-words text-sm font-semibold leading-5">{result}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Это то, что останется у тебя в проекте после прохождения.
          </p>
        </Section>

        <Section title="Что внутри руководства">
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-semibold text-foreground">{guide.proof.value}</span>
            {" — "}
            {guide.proof.caption}. {guide.proof.detail}
          </p>
          <ul className="mt-5 grid gap-5">
            {guide.chapters.map((chapter, index) => (
              <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={chapter.title}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-8 place-items-center rounded-xl text-sm font-semibold tabular-nums",
                    chapterTone(chapter.tone),
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="break-words font-semibold leading-6">{chapter.title}</p>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{chapter.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Как это работает">
          <p className="break-words text-sm leading-6 md:text-base md:leading-7">{guide.workflow}</p>
          <div className="mt-5 rounded-2xl bg-muted p-5">
            <p className="font-semibold">Что понадобится</p>
            <ul className="mt-4 grid gap-4">
              {guide.requirements.map((requirement) => (
                <li key={requirement.title}>
                  <p className="break-words text-sm font-semibold leading-5">{requirement.title}</p>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{requirement.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="Артефакты">
          <ul className="grid gap-3">
            {guide.artifacts.map((artifact) => (
              <li
                className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-2xl border border-border p-4"
                key={artifact.title}
              >
                <FileDown aria-hidden="true" className="mt-0.5 size-5 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="break-words font-semibold leading-6">{artifact.title}</p>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{artifact.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={guide.support.title}>
          <div className="rounded-2xl bg-muted p-5">
            <MessageCircle aria-hidden="true" className="size-6 text-accent" />
            <p className="mt-3 break-words text-sm leading-6">{guide.support.detail}</p>
            <ul className="mt-4 grid gap-2">
              {guide.support.items.map((item) => (
                <li className="flex items-start gap-2 break-words text-sm leading-6" key={item}>
                  <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-accent" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="Что остаётся за границами">
          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 rounded-2xl border border-border p-5">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 text-muted-foreground" />
            <p className="break-words text-sm leading-6 text-muted-foreground">{guide.outOfScope}</p>
          </div>
        </Section>
      </main>

      {/* Sticky, not fixed: the bar has to pin to whatever scrolls it — the page,
          a Storybook viewport frame or a Docs block — and never leave the flow. */}
      <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[46rem] items-center gap-3 px-4 py-3 sm:px-6">
          <button
            className="min-h-12 flex-1 rounded-2xl bg-foreground px-6 text-base font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={onOpen}
            type="button"
          >
            Открыть программу
          </button>
        </div>
        <p className="mx-auto w-full max-w-[46rem] px-4 pb-3 text-center text-xs text-muted-foreground sm:px-6">
          {guide.freeMaterials} материала открыты без подписки
        </p>
      </div>
    </>
  );
}

function Hero({
  guide,
  onOpen,
}: {
  readonly guide: ShowcaseGuide;
  readonly onOpen: () => void;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-[1.75rem] bg-primary p-4 text-white">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">{guide.topic}</p>
      <div className="mt-3 grid min-h-52 place-items-center rounded-2xl bg-white/10 sm:min-h-64">
        <Play aria-hidden="true" className="size-10 opacity-60" />
        <p className="mt-2 text-xs text-white/60">Здесь будет анимация продукта</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/70 tabular-nums">{guide.materials} материалов</p>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={onOpen}
          type="button"
        >
          Открыть
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  );
}

function ProgrammeStub({
  guide,
  onBack,
}: {
  readonly guide: ShowcaseGuide;
  readonly onBack: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[46rem] px-4 pb-24 sm:px-6">
      <button
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-muted px-4 text-sm font-semibold"
        onClick={onBack}
        type="button"
      >
        Назад к описанию
      </button>
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Программа · {guide.name}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Это существующая страница руководства: главы, материалы, дополнительные материалы и
        артефакты. Здесь прототип показывает только её место в переходе.
      </p>
      <ol className="mt-6 grid gap-6">
        {guide.chapters.map((chapter, chapterIndex) => (
          <li key={chapter.title}>
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
              Глава {chapterIndex + 1} из {guide.chapters.length}
            </p>
            <p className="mt-1 text-xl font-semibold tracking-[-0.02em]">{chapter.title}</p>
            <ul className="mt-3 grid gap-2">
              {Array.from({ length: chapter.materials }, (_, index) => {
                const free = chapterIndex === 0 && index < 2;
                return (
                  <li
                    className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm"
                    key={index}
                  >
                    {free ? (
                      <Play aria-hidden="true" className="size-4 text-action" />
                    ) : (
                      <Lock aria-hidden="true" className="size-4 text-muted-foreground" />
                    )}
                    <span className={cn("min-w-0 flex-1", free ? "" : "text-muted-foreground")}>
                      Материал {index + 1}
                    </span>
                    {free ? <span className="text-xs font-semibold text-action">Открыт</span> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Section({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="break-words text-xl font-semibold tracking-[-0.02em] md:text-2xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function chapterTone(tone: ShowcaseChapter["tone"]): string {
  switch (tone) {
    case "amber":
      return "bg-cover-sand text-foreground";
    case "blue":
      return "bg-cover-blue text-foreground";
    case "green":
      return "bg-cover-mint text-foreground";
    case "purple":
      return "bg-cover-lavender text-foreground";
    case "rose":
      return "bg-cover-coral text-foreground";
  }
}
