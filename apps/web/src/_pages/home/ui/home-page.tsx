import { ArrowRight, DatabaseZap, FileText } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { MaterialCard } from "@/entities/material";
import {
  PlaylistCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { libraryRouteHref } from "@/shared/routing/library-route";
import { purchaseInvitation } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import type { HomeContinuation, HomeResult, HomeView } from "../model/home-view";
import { FeaturedSeries, HomeAccessInvitation, HomeMembershipBenefits } from "./guest-home";
import "./home-page.css";

export function HomePage({ result, personal, continuation }: { readonly result: HomeResult; readonly personal?: ReactNode; readonly continuation?: HomeContinuation }) {
  if (result.kind === "unavailable") {
    return <>{personal}<HomeUnavailable /></>;
  }
  return <HomeReady home={result.value} personal={personal} continuation={continuation} />;
}

function HomeReady({ home, personal, continuation }: { readonly home: HomeView; readonly personal: ReactNode; readonly continuation: HomeContinuation | undefined }) {
  // Подписку предлагает только включённая продажа: её состояние приходит с главной,
  // а адрес витрины принадлежит платформе, а не внешнему сервису.
  const offer = purchaseInvitation({ subscriptionOffered: home.membership.kind === "inactive" });
  const series = continuation?.series;
  const video = continuation?.video;
  const playlists = series === undefined ? home.playlists : [series.collection, ...home.playlists.filter((item) => item.slug !== series.collection.slug)];
  const videos = video === undefined ? home.videos : [video.material, ...home.videos.filter((item) => item.slug !== video.material.slug)];
  return (
    <div className="home-page @container/home min-w-0" data-home-membership={home.membership.kind}>
      <h1 className="sr-only">Главная</h1>
      {home.pinnedSeries && <FeaturedSeries series={home.pinnedSeries} />}
      {personal}
      <PlaylistSection playlists={playlists} continuation={series} />
      <TopicSection topics={home.topics} />
      {offer && <HomeAccessInvitation href={offer.href} />}
      <MaterialSection
        formatSlug="video"
        id="home-videos"
        items={videos}
        continuation={video}
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
      {offer ? <HomeMembershipBenefits href={offer.href} /> : <CatalogInvitation />}
    </div>
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
                href={libraryRouteHref({ topicSlug: topic.slug, q: "", formatSlug: null, sort: "newest" })}
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
  continuation,
}: {
  readonly formatSlug: "guide" | "video";
  readonly id: string;
  readonly items: HomeView["videos"];
  readonly title: string;
  readonly variant?: "default" | "video";
  readonly continuation?: HomeContinuation["video"];
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
                {...(continuation?.material.slug === material.slug ? { resumeLabel: continuation.label, readingStatus: null } : {})}
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
  continuation,
}: {
  readonly playlists: HomeView["playlists"];
  readonly continuation: HomeContinuation["series"];
}) {
  return (
    <section aria-labelledby="home-series">
      <SectionHeading
        action="Все руководства"
        className="mt-2"
        href="/library#series-heading"
        id="home-series"
        title="Руководства"
      />
      {playlists.length === 0 ? (
        <EmptyCollection label="Руководств пока нет." />
      ) : (
        <div className="public-horizontal-rail -mx-4 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 py-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0">
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
                  ...(continuation?.collection.slug === playlist.slug ? { continuation: { read: continuation.read, total: continuation.total } } : {}),
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
      <h2 className="mt-10 text-xl font-semibold tracking-[-0.04em] md:mt-12 md:text-2xl" id="home-notes">Заметки</h2>
      {items.length === 0 ? (
        <EmptyCollection label="В этом разделе пока нет опубликованных материалов." />
      ) : (
        <ul aria-label="Лента заметок" className="mt-4 grid items-start gap-4 @min-[48rem]/home:grid-cols-2" role="list">
          {items.map((material, index) => {
            const teaser = items.length > 1 && index === items.length - 1;
            return <li className={teaser ? "relative isolate overflow-hidden rounded-[1.5rem]" : items.length === 1 ? "col-span-full flex justify-center" : undefined} key={material.slug}>
              <div aria-hidden={teaser || undefined} inert={teaser} className={teaser ? "pointer-events-none max-h-64 select-none opacity-80 blur-[4px] [mask-image:linear-gradient(#000,transparent)]" : undefined}>
                <MaterialCard headingLevel="h3" material={material} returnHref="/" variant="feed" {...(teaser ? { readingStatus: null } : {})} />
              </div>
              {teaser ? <div className="absolute inset-0 flex items-center justify-center px-3"><AllNotesLink /></div> : null}
            </li>;
          })}
        </ul>
      )}
      {items.length < 2 ? <div className="flex justify-center py-6"><AllNotesLink /></div> : null}
    </section>
  );
}

function AllNotesLink() {
  return <Link aria-label="Все заметки" className="inline-flex min-h-14 max-w-full items-center gap-3 rounded-full border border-white bg-white px-4 py-3 text-base font-semibold tracking-[-0.025em] no-underline shadow-floating-nav transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transform-none md:px-5 md:text-lg" href="/library?format=note">
    <FileText aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
    <span className="whitespace-nowrap">Все заметки</span>
  </Link>;
}

function SectionHeading({
  action,
  className = "mt-10 md:mt-12",
  href,
  id,
  title,
}: {
  readonly action: string;
  readonly className?: string;
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
      className={`home-section-heading ${className}`}
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
        Ищите независимо от Руководств по названию, теме, формату или тегу.
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
