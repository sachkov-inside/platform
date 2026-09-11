import { ArrowRight, FileDown, Play } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type GuideChapter } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";

/**
 * Программа руководства глазами того, кто ещё не купил: сколько глав, как они называются и что
 * в каждой разбирают. Сами материалы живут на странице программы, поэтому здесь ни ссылок на
 * них, ни состояний доступа — только обещание маршрута.
 */
export function GuideChaptersOverview({
  chapters,
  materialCount,
}: {
  readonly chapters: readonly GuideChapter[];
  readonly materialCount: number;
}) {
  if (chapters.length === 0) return null;
  return (
    <section aria-labelledby="guide-chapters" className="mt-10">
      <h2
        className="break-words text-xl font-semibold tracking-[-0.02em] md:text-2xl"
        id="guide-chapters"
      >
        Что внутри руководства
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        <span className="font-semibold text-foreground">
          {chapters.length === 1 ? "1 глава" : `${String(chapters.length)} глав`}
        </span>
        {" · "}
        {formatMaterialCount(materialCount)}
      </p>
      <ol className="mt-5 grid gap-5">
        {chapters.map((chapter, index) => (
          <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={chapter.id}>
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-xl bg-secondary text-sm font-semibold tabular-nums"
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
    </section>
  );
}

/**
 * Артефакты как обещание результата: что останется в проекте после руководства. Файлы и ссылки
 * выдаёт программа по праву доступа, поэтому здесь только название и назначение.
 */
export function GuideArtifactsPromise({
  artifacts,
}: {
  readonly artifacts: ReaderGuideArtifactsResult;
}) {
  if (artifacts.kind !== "ready" || artifacts.artifacts.length === 0) return null;
  return (
    <section aria-labelledby="guide-artifacts-promise" className="mt-10">
      <h2
        className="break-words text-xl font-semibold tracking-[-0.02em] md:text-2xl"
        id="guide-artifacts-promise"
      >
        Что останется в проекте
      </h2>
      <ul className="mt-5 grid gap-3">
        {artifacts.artifacts.map((artifact) => (
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
    </section>
  );
}

/**
 * Единственное действие страницы продукта. Панель липнет к тому, что её прокручивает, и на узком
 * экране останавливается над плавающим меню оболочки, а не уходит под него.
 */
export function GuideProgrammeBar({ href }: { readonly href: Route }) {
  return (
    <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 mt-10 rounded-2xl border border-border bg-background/95 shadow-card backdrop-blur lg:bottom-4">
      <div className="flex items-center gap-3 p-2.5">
        <Button asChild className="h-auto min-h-11 flex-1 whitespace-normal" size="lg">
          <Link href={href}>
            Открыть программу
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Бесплатный вход из обложки: первый открытый материал, когда он есть. */
export function GuideFreeEntry({ href }: { readonly href: Route }) {
  return (
    <Button
      asChild
      className="mt-5 h-auto min-h-11 max-w-full whitespace-normal border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white"
      variant="outline"
    >
      <Link href={href}>
        <Play aria-hidden="true" className="size-4 shrink-0" />
        Попробовать бесплатно
      </Link>
    </Button>
  );
}
