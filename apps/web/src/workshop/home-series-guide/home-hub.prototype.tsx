/* eslint-disable next/no-html-link-for-pages -- Storybook-only links intercepted into local prototype state. */
import { ArrowRight, Search } from "lucide-react";
import { useState } from "react";
import type { HomeView } from "@/_pages/home";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import {
  PlaylistCard,
  TopicCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";

function Heading({
  id,
  title,
  action,
  href,
}: {
  readonly id: string;
  readonly title: string;
  readonly action: string;
  readonly href: string;
}) {
  return (
    <PublicSectionHeading
      id={id}
      title={title}
      aside={
        <a className="shrink-0 text-sm font-semibold text-action" href={href}>
          {action}
        </a>
      }
    />
  );
}

export function HomeHub({
  home,
  membershipHref,
  member,
}: {
  readonly home: HomeView;
  readonly membershipHref: string;
  readonly member: boolean;
}) {
  return (
    <div className="hsg-hub @container/home min-w-0">
      <h1 className="sr-only" tabIndex={-1}>
        Главная
      </h1>
      <nav className="hsg-hub-shortcuts" aria-label="Разделы главной">
        <a href="#hub-videos">Новое</a>
        <a href="#hub-series">Серии</a>
        <a href="#hub-guides">Гайды</a>
        <a href="#hub-notes">Заметки</a>
        <a href="/library" aria-label="Найти материал">
          <Search size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Найти материал</span>
        </a>
      </nav>
      {!member && (
        <aside className="hsg-hub-membership" aria-label="Подписка Inside">
          <div>
            <strong>Внутри — весь процесс разработки</strong>
            <p>
              Видео, гайды и рабочие решения с контекстом. Обсуждаем и применяем
              вместе в закрытом сообществе.
            </p>
          </div>
          <Button asChild className="rounded-full">
            <a href={membershipHref}>
              Что даёт подписка <ArrowRight aria-hidden="true" />
            </a>
          </Button>
        </aside>
      )}
      <section aria-labelledby="hub-topics">
        <Heading
          id="hub-topics"
          title="Темы"
          action="Все темы"
          href="/library?view=topics"
        />
        <ul
          className="public-horizontal-rail -mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pt-1 pb-1 sm:mx-0 sm:px-0 md:gap-5"
          role="list"
        >
          {home.topics.map((topic) => (
            <li className="w-24 shrink-0 md:w-28" key={topic.slug}>
              <TopicCard
                compact
                topic={{ ...topic, summary: topic.summary ?? "" }}
                returnHref="/"
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="hub-series">
        <Heading
          id="hub-series"
          title="Серии и плейлисты"
          action="Все серии"
          href="/library?view=series"
        />
        <div className="hsg-hub-series mt-5 grid gap-4 md:grid-cols-2">
          {home.playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.slug}
              returnHref="/"
              playlist={{
                ...playlist,
                summary: playlist.summary ?? "",
                countLabel: formatMaterialCount(playlist.count),
              }}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="hub-videos">
        <Heading
          id="hub-videos"
          title="Новые видео"
          action="Все видео"
          href="/library?format=video"
        />
        <ul
          className="mt-5 grid grid-cols-2 items-start gap-x-3 gap-y-7 md:grid-cols-3 md:gap-x-5"
          role="list"
        >
          {home.videos.slice(0, 3).map((material) => (
            <li className="min-w-0" key={material.slug}>
              <MaterialCard
                headingLevel="h3"
                variant="compact"
                material={material}
                returnHref="/"
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="hub-guides">
        <Heading
          id="hub-guides"
          title="Свежие гайды"
          action="Все гайды"
          href="/library?format=guide"
        />
        <div className="hsg-hub-guides">
          <ul className="grid grid-cols-2 gap-4" role="list">
            {home.guides.map((material) => (
              <li className="min-w-0" key={material.slug}>
                <MaterialCard
                  headingLevel="h3"
                  material={material}
                  returnHref="/"
                />
              </li>
            ))}
          </ul>
          <aside className="hsg-hub-guide-context">
            <span className="text-xs font-semibold uppercase tracking-wider text-eyebrow">
              Попробовать на своём проекте
            </span>
            <h3>От правил к проверенной задаче</h3>
            <p>
              Начните с настройки harness, затем проведите задачу с агентом от
              постановки до проверки.
            </p>
            <a
              className="text-sm font-semibold text-action"
              href="/materials/guide-a"
            >
              Читать первый гайд бесплатно →
            </a>
            <a
              className="text-sm font-semibold text-action"
              href="/series/harness"
            >
              Посмотреть всю серию →
            </a>
          </aside>
        </div>
      </section>
      <section aria-labelledby="hub-notes">
        <Heading
          id="hub-notes"
          title="Заметки"
          action="Все заметки"
          href="/library?format=note"
        />
        <ul
          aria-label="Лента заметок"
          className="mt-2 max-w-[48rem] divide-y divide-border"
          role="list"
        >
          {home.notes.map((material) => (
            <li key={material.slug}>
              <MaterialCard
                headingLevel="h3"
                variant="feed"
                material={material}
                returnHref="/"
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Small in-memory destination so the hub's navigation can actually be tried. */
export function HubLibrary({
  home,
  format,
  topic,
  view,
}: {
  readonly home: HomeView;
  readonly format: string;
  readonly topic: string;
  readonly view: string;
}) {
  const [query, setQuery] = useState("");
  const materials = [...home.videos, ...home.guides, ...home.notes].filter(
    (material) =>
      (!format || material.formatSlug === format) &&
      (!topic || material.topicSlug === topic) &&
      `${material.title} ${material.summary}`
        .toLocaleLowerCase("ru")
        .includes(query.toLocaleLowerCase("ru")),
  );
  return (
    <div className="hsg-hub">
      <h1 tabIndex={-1} className="text-3xl font-semibold tracking-tight">
        {home.topics.find((item) => item.slug === topic)?.name ??
          (view === "series"
            ? "Серии и плейлисты"
            : view === "topics"
              ? "Темы"
              : "База знаний")}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Каталог образцов для проверки навигации.
      </p>
      <nav className="hsg-hub-shortcuts" aria-label="Форматы материалов">
        {[
          ["", "Все"],
          ["video", "Видео"],
          ["guide", "Гайды"],
          ["note", "Заметки"],
        ].map(([value, label]) => (
          <a
            key={label}
            aria-current={format === value && !view ? "page" : undefined}
            href={`/library?format=${value ?? ""}&topic=${topic}`}
          >
            {label}
          </a>
        ))}
      </nav>
      {view === "series" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {home.playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.slug}
              playlist={{
                ...playlist,
                summary: playlist.summary ?? "",
                countLabel: formatMaterialCount(playlist.count),
              }}
            />
          ))}
        </div>
      ) : view === "topics" ? (
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4" role="list">
          {home.topics.map((item) => (
            <li key={item.slug}>
              <TopicCard topic={{ ...item, summary: item.summary ?? "" }} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <label className="block text-sm font-semibold" htmlFor="hub-search">
            Поиск по материалам
          </label>
          <input
            id="hub-search"
            type="search"
            className="mt-2 mb-5 min-h-11 w-full rounded-xl border border-border bg-background px-4"
            placeholder="Название или описание"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {formatMaterialCount(materials.length)}
          </p>
          <ul className="grid gap-4" role="list">
            {materials.map((material) => (
              <li key={material.slug}>
                <MaterialCard
                  material={material}
                  variant={material.formatSlug === "note" ? "feed" : "row"}
                />
              </li>
            ))}
          </ul>
          {materials.length === 0 && (
            <p>Ничего не найдено. Попробуйте другое слово или формат.</p>
          )}
        </>
      )}
    </div>
  );
}

export function HubNote({
  material,
}: {
  readonly material: MaterialPreview | undefined;
}) {
  if (!material) return <h1 tabIndex={-1}>Заметка не найдена</h1>;
  return (
    <article className="hsg-reader hsg-reader-style">
      <p className="hsg-eyebrow">Заметка · иллюстративный образец из main</p>
      <h1 tabIndex={-1}>{material.title}</h1>
      <p className="hsg-lead">{material.summary}</p>
      <p className="hsg-muted">
        Это карточка из принятого макета ленты. Полный авторский текст в
        прототип не добавлен.
      </p>
    </article>
  );
}
