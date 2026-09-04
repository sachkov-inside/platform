import { DatabaseZap } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { MaterialCard } from "@/entities/material";
import {
  PlaylistCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import { Button } from "@/shared/ui/button";
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
      <TopicRail topics={home.topics} />
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

function TopicRail({ topics }: { readonly topics: HomeView["topics"] }) {
  return (
    <nav
      aria-label="Темы"
      className="public-horizontal-rail -mx-4 mt-7 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <Link
        className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[#202124] px-4 text-sm font-semibold text-white no-underline"
        href="/library"
      >
        Все темы
      </Link>
      {topics.map((topic) => (
        <Link
          className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[#f3f1ed] px-4 text-sm font-semibold text-[#5f5e59] no-underline hover:text-[#202124] focus-visible:outline-ring"
          href={collectionDiscoveryHref("topic", topic.slug, "/")}
          key={topic.slug}
          prefetch={false}
        >
          {topic.name}
        </Link>
      ))}
    </nav>
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
              : "mt-5 grid grid-cols-2 gap-x-3 gap-y-7 md:grid-cols-3 md:gap-x-5 md:gap-y-9"
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
    <div className="mt-11 flex items-end justify-between gap-4">
      <h2
        className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl"
        id={id}
      >
        {title}
      </h2>
      <Link
        aria-label={action}
        className="shrink-0 text-sm font-semibold text-[#b83a1d] no-underline"
        href={href}
      >
        {action}
      </Link>
    </div>
  );
}

function EmptyCollection({ label }: { readonly label: string }) {
  return (
    <p className="mt-5 rounded-[1.5rem] bg-[#f3f1ed] px-5 py-7 text-sm text-[#5f5e59]">
      {label}
    </p>
  );
}

function HomeUnavailable() {
  return (
    <>
      <PublicProductHeader />
      <section className="mt-9 rounded-[2rem] bg-[#f3f1ed] px-6 py-9" data-home-state="unavailable">
        <DatabaseZap aria-hidden="true" className="size-7 text-[#c7461e]" />
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.035em]">
          Главная временно недоступна
        </h1>
        <p className="mt-3 text-[#5f5e59]">
          Откройте Базу знаний или попробуйте ещё раз.
        </p>
        <Button asChild className="mt-6">
          <Link href="/library">Открыть Базу знаний</Link>
        </Button>
      </section>
    </>
  );
}
