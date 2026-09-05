import { DatabaseZap } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { MaterialCard } from "@/entities/material";
import {
  PlaylistCard,
  TopicCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import { PublicProductHeader } from "@/widgets/application-shell";
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
      <PublicProductHeader />
      <h1 className="sr-only">Главная</h1>
      <TopicSection topics={home.topics} />
      <MaterialSection
        formatSlug="video"
        id="home-videos"
        items={home.videos}
        title="Новые видео"
        variant="video"
      />
      <PlaylistSection playlists={home.playlists} />
      <MaterialSection
        formatSlug="guide"
        id="home-guides"
        items={home.guides}
        title="Свежие гайды"
      />
      <NoteFeed items={home.notes} />
    </div>
  );
}

function TopicSection({ topics }: { readonly topics: HomeView["topics"] }) {
  return (
    <section aria-labelledby="home-topics">
      <SectionHeading action="Все темы" href="/library" id="home-topics" title="Темы" />
      {topics.length === 0 ? (
        <EmptyCollection label="Тем пока нет." />
      ) : (
        <ul
          className="public-horizontal-rail -mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pt-1 pb-1 sm:mx-0 sm:px-0 md:gap-5"
          role="list"
        >
          {topics.map((topic) => (
            <li className="w-24 shrink-0 md:w-28" key={topic.slug}>
              <TopicCard
                compact
                returnHref="/"
                topic={{
                  count: topic.count,
                  cover: topic.cover,
                  name: topic.name,
                  slug: topic.slug,
                  summary: topic.summary ?? "",
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MaterialSection({
  formatSlug,
  id,
  items,
  title,
  variant = "default",
}: {
  readonly formatSlug: "guide" | "video";
  readonly id: string;
  readonly items: HomeView["videos"];
  readonly title: string;
  readonly variant?: "default" | "video";
}) {
  return (
    <section aria-labelledby={id}>
      <SectionHeading
        action={formatSlug === "video" ? "Все видео" : "Все гайды"}
        href={`/library?format=${formatSlug}`}
        id={id}
        title={title}
      />
      {items.length === 0 ? (
        <EmptyCollection label="В этом разделе пока нет опубликованных материалов." />
      ) : (
        <ul
          className={
            variant === "video"
              ? "mt-5 grid grid-cols-2 items-start gap-x-3 gap-y-7 md:grid-cols-3 md:gap-x-5"
              : "mt-5 grid grid-cols-2 gap-x-4 gap-y-8 @min-[40rem]/home:grid-cols-3 @min-[52rem]/home:grid-cols-4 @min-[40rem]/home:gap-x-5 @min-[40rem]/home:gap-y-9"
          }
          data-video-grid={variant === "video" ? true : undefined}
          role="list"
        >
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

function PlaylistSection({
  playlists,
}: {
  readonly playlists: HomeView["playlists"];
}) {
  return (
    <section aria-labelledby="home-playlists">
      <SectionHeading
        action="Все плейлисты"
        href="/library"
        id="home-playlists"
        title="Плейлисты"
      />
      {playlists.length === 0 ? (
        <EmptyCollection label="Плейлистов пока нет." />
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.slug}
              returnHref="/"
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

function NoteFeed({ items }: { readonly items: HomeView["notes"] }) {
  return (
    <section aria-labelledby="home-notes">
      <SectionHeading
        action="Все заметки"
        href="/library?format=note"
        id="home-notes"
        title="Заметки"
      />
      {items.length === 0 ? (
        <EmptyCollection label="В этом разделе пока нет опубликованных материалов." />
      ) : (
        <ul aria-label="Лента заметок" className="mt-5 grid gap-3" role="list">
          {items.map((material) => (
            <li key={material.slug}>
              <MaterialCard
                headingLevel="h3"
                material={material}
                returnHref="/"
                variant="feed"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionHeading({
  action,
  href,
  id,
  title,
}: {
  readonly action: string;
  readonly href: Route;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <PublicSectionHeading
      aside={
        <Link
          aria-label={action}
          className="shrink-0 text-sm font-semibold text-action no-underline"
          href={href}
        >
          {action}
        </Link>
      }
      className={id === "home-topics" ? "mt-6 md:mt-2" : "mt-10 md:mt-12"}
      id={id}
      title={title}
    />
  );
}

function EmptyCollection({ label }: { readonly label: string }) {
  return (
    <p className="mt-5 rounded-[1.5rem] bg-muted px-5 py-7 text-sm text-muted-foreground">
      {label}
    </p>
  );
}

function HomeUnavailable() {
  return (
    <>
      <PublicProductHeader />
      <section className="mt-9 rounded-[2rem] bg-muted px-6 py-9" data-home-state="unavailable">
        <DatabaseZap aria-hidden="true" className="size-7 text-accent" />
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.035em]">
          Главная временно недоступна
        </h1>
        <p className="mt-3 text-muted-foreground">
          Откройте Базу знаний или попробуйте ещё раз.
        </p>
        <Button asChild className="mt-6">
          <Link href="/library">Открыть Базу знаний</Link>
        </Button>
      </section>
    </>
  );
}
