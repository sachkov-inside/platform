import { ArrowRight, DatabaseZap, UserRound } from "lucide-react";
import Link from "next/link";

import { MaterialCard } from "@/entities/material";
import {
  PlaylistCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import type { HomeResult, HomeView } from "../model/home-view";

export function HomePage({ result }: { readonly result: HomeResult }) {
  if (result.kind === "unavailable") {
    return <HomeUnavailable />;
  }
  return <HomeReady home={result.value} />;
}

function HomeReady({ home }: { readonly home: HomeView }) {
  return (
    <div className="@container/home min-w-0">
      <header className="flex items-end justify-between gap-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Sachkov Inside</p>
          <h1 className="mt-1 text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
            Добро пожаловать
          </h1>
          <p className="mt-2 max-w-[52ch] text-sm leading-6 text-muted-foreground sm:text-base">
            Новые видео, плейлисты и практические материалы из Базы знаний.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild className="hidden sm:inline-flex" variant="outline">
            <Link href="/library">
              Вся база
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Link aria-label="Открыть профиль" className="grid size-11 place-items-center rounded-full bg-sidebar text-sidebar-foreground no-underline shadow-sm hover:bg-sidebar-accent focus-visible:outline-ring" href="/account">
            <UserRound aria-hidden="true" className="size-5 text-sidebar-primary" />
          </Link>
        </div>
      </header>

      <TopicRail topics={home.topics} />
      <MaterialSection items={home.videos} title="Видео" variant="video" />
      <PlaylistSection playlists={home.playlists} />
      <MaterialSection items={home.guides} title="Гайды" />
      <MaterialSection items={home.notes} title="Заметки" />
    </div>
  );
}

function TopicRail({ topics }: { readonly topics: HomeView["topics"] }) {
  if (topics.length === 0) return null;
  return (
    <section aria-labelledby="home-topics" className="mt-8 sm:mt-10">
      <h2 className="text-sm font-semibold text-muted-foreground" id="home-topics">
        Темы
      </h2>
      <ul className="-mx-5 mt-3 flex snap-x gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8 md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden" role="list">
        {topics.map((topic) => (
          <li className="shrink-0 snap-start" key={topic.slug}>
            <Link className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold no-underline shadow-sm hover:border-accent/50 hover:bg-accent/10 focus-visible:outline-ring" href={`/topics/${topic.slug}`} prefetch={false}>
              {topic.name}
              <span className="text-xs font-normal text-muted-foreground">{topic.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MaterialSection({
  items,
  title,
  variant = "default",
}: {
  readonly items: HomeView["videos"];
  readonly title: string;
  readonly variant?: "default" | "video";
}) {
  return (
    <section aria-labelledby={`home-${title}`} className="mt-10 sm:mt-12">
      <SectionHeading id={`home-${title}`} title={title} />
      {items.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-muted px-5 py-7 text-sm text-muted-foreground">
          В этом разделе пока нет опубликованных материалов.
        </p>
      ) : (
        <ul className={variant === "video" ? "mt-4 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3" : "mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"} role="list">
          {items.map((material) => (
            <li className="min-w-0" key={material.slug}>
              <MaterialCard
                headingLevel="h3"
                material={material}
                returnHref="/"
                variant={variant === "video" ? "compact" : "default"}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlaylistSection({ playlists }: { readonly playlists: HomeView["playlists"] }) {
  return (
    <section aria-labelledby="home-playlists" className="mt-10 sm:mt-12">
      <SectionHeading id="home-playlists" title="Плейлисты" />
      {playlists.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-muted px-5 py-7 text-sm text-muted-foreground">
          Плейлистов пока нет.
        </p>
      ) : (
        <div className="@container/playlist-surface mt-4 grid gap-4 @min-[48rem]/home:grid-cols-2">
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.slug}
              playlist={{
                countLabel: formatMaterialCount(playlist.count),
                cover: playlist.cover,
                name: playlist.name,
                previewItems: playlist.previewItems,
                slug: playlist.slug,
                summary: playlist.summary ?? "",
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionHeading({ id, title }: { readonly id: string; readonly title: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl" id={id}>
        {title}
      </h2>
      <Link className="text-sm font-semibold text-muted-foreground no-underline hover:text-foreground" href="/library">
        Смотреть все
      </Link>
    </div>
  );
}

function HomeUnavailable() {
  return (
    <section className="rounded-2xl bg-muted px-6 py-9" data-home-state="unavailable">
      <DatabaseZap aria-hidden="true" className="size-7 text-accent" />
      <h1 className="mt-5 text-3xl font-semibold tracking-[-0.035em]">Главная временно недоступна</h1>
      <p className="mt-3 text-muted-foreground">Откройте Базу знаний или попробуйте ещё раз.</p>
      <Button asChild className="mt-6">
        <Link href="/library">Открыть Базу знаний</Link>
      </Button>
    </section>
  );
}
