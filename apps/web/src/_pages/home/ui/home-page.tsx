import { ArrowRight, DatabaseZap, Search } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { MaterialCard } from "@/entities/material";
import {
  PlaylistCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
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
      <HomeShortcuts />
      <MembershipInvitation membership={home.membership} />
      <PlaylistSection playlists={home.playlists} />
      <TopicSection topics={home.topics} />
      <MaterialSection
        formatSlug="video"
        id="home-videos"
        items={home.videos}
        title="Новые видео"
        variant="video"
      />
      <MaterialSection
        formatSlug="guide"
        id="home-guides"
        items={home.guides}
        title="Свежие гайды"
      />
      <NoteFeed items={home.notes} />
      <CatalogInvitation />
    </div>
  );
}

function HomeShortcuts() {
  return (
    <nav
      aria-label="Разделы главной"
      className="public-horizontal-rail flex items-center gap-5 overflow-x-auto py-3 text-sm font-semibold text-muted-foreground"
    >
      <a className="min-h-11 shrink-0 content-center hover:text-action" href="#home-series">
        Серии
      </a>
      <a className="min-h-11 shrink-0 content-center hover:text-action" href="#home-videos">
        Новое
      </a>
      <a className="min-h-11 shrink-0 content-center hover:text-action" href="#home-guides">
        Гайды
      </a>
      <a className="min-h-11 shrink-0 content-center hover:text-action" href="#home-notes">
        Заметки
      </a>
      <Link
        aria-label="Найти материал"
        className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-2 no-underline hover:text-action"
        href="/library"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Найти материал</span>
      </Link>
    </nav>
  );
}

function MembershipInvitation({
  membership,
}: {
  readonly membership: HomeView["membership"];
}) {
  if (membership.kind !== "inactive") return null;
  return (
    <aside
      aria-label="Подписка Inside"
      className="mt-2 grid gap-5 rounded-[1.5rem] bg-muted px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
    >
      <div className="min-w-0">
        <strong className="text-lg tracking-[-0.02em]">Внутри — весь процесс разработки</strong>
        <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">
          Видео, гайды и рабочие решения с контекстом. Обсуждаем и применяем вместе в закрытом сообществе.
        </p>
      </div>
      <Button asChild className="w-full rounded-full sm:w-auto">
        <a href={membership.acquisitionUrl} rel="noopener noreferrer" target="_blank">
          Что даёт подписка
          <ArrowRight aria-hidden="true" />
        </a>
      </Button>
    </aside>
  );
}

function TopicSection({ topics }: { readonly topics: HomeView["topics"] }) {
  return (
    <nav aria-label="Фильтр по теме" className="mt-6 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm text-muted-foreground">По теме</span>
      {topics.length === 0 ? (
        <span className="text-sm text-muted-foreground">Тем пока нет</span>
      ) : (
        <ul className="flex flex-wrap gap-2" role="list">
          {topics.map((topic) => (
            <li key={topic.slug}>
              <Link
                className="inline-flex min-h-11 items-center rounded-full bg-muted px-4 text-sm font-semibold text-muted-foreground no-underline hover:text-action focus-visible:outline-ring"
                href={collectionDiscoveryHref("topic", topic.slug, "/")}
              >
                {topic.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link className="inline-flex min-h-11 items-center px-2 text-sm font-semibold no-underline" href="/library">
        Все материалы
      </Link>
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
    <section aria-labelledby="home-series">
      <SectionHeading
        action="Все серии"
        href="/library#series-heading"
        id="home-series"
        title="Серии"
      />
      {playlists.length === 0 ? (
        <EmptyCollection label="Серий пока нет." />
      ) : (
        <div className="public-horizontal-rail -mx-4 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:px-0">
          {playlists.slice(0, 2).map((playlist) => (
            <div className="w-[88%] shrink-0 snap-center md:w-auto" key={playlist.slug}>
              <PlaylistCard
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
            </div>
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
        <ul aria-label="Лента заметок" className="mt-2 max-w-[48rem] divide-y divide-border" role="list">
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
      className="mt-10 md:mt-12"
      id={id}
      title={title}
    />
  );
}

function CatalogInvitation() {
  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="home-catalog">
      <h2 className="text-2xl font-semibold tracking-[-0.03em]" id="home-catalog">
        Все материалы в одном каталоге
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">
        Ищите независимо от Серий по названию, теме, формату или тегу.
      </p>
      <Button asChild className="mt-5" variant="outline">
        <Link href="/library">
          Открыть Базу знаний
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </section>
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
