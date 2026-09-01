import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Clock3,
  ListVideo,
  Play,
} from "lucide-react";
import Link from "next/link";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  MaterialCard,
  type MaterialPreviewFixture,
} from "@/workshop/material-preview.prototype";

/**
 * PROTOTYPE #208. Two canonical pages answer how a Topic gathers related Playlists and Materials,
 * and how a cross-Topic Playlist exposes one ordered route. Navigation stays in the same tab.
 * Practice would become a separate Topic section after its domain contract exists; it is not
 * rendered as an empty promise here. The owner rejected an in-canvas prototype switcher in #197,
 * so Topic and Playlist are separate Storybook stories instead of variants behind a bottom bar.
 */

export type CollectionScenario = "empty" | "long-title" | "populated" | "sparse";

export interface TopicPagePrototypeProps {
  readonly scenario?: CollectionScenario;
}

export interface PlaylistPagePrototypeProps {
  readonly scenario?: CollectionScenario;
}

/**
 * Candidate v1 contract shared by authoring input and the public collection projection.
 * Summary is the only field beyond name/slug; Topic and Playlist covers are not required in v1.
 */
export interface CollectionMetadataContract {
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

interface PlaylistCatalogFixture extends CollectionMetadataContract {
  readonly totalCount: number;
}

interface RelatedPlaylistFixture extends PlaylistCatalogFixture {
  readonly matchingCount: number;
}

interface PlaylistMaterialFixture {
  readonly access: "Бесплатно" | "Для участников";
  readonly duration?: string;
  readonly format: "Видео" | "Гайд";
  readonly slug: string;
  readonly summary: string;
  readonly title: string;
  readonly topic: string;
  readonly topicSlug: string;
}

interface TopicPageFixture extends CollectionMetadataContract {
  readonly materials: readonly MaterialPreviewFixture[];
  readonly playlists: readonly RelatedPlaylistFixture[];
}

interface PlaylistPageFixture extends CollectionMetadataContract {
  readonly materials: readonly PlaylistMaterialFixture[];
  readonly topics: readonly { readonly name: string; readonly slug: string }[];
}

const navigationItems = [
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

const platformPlaylistMetadata = {
  name: "Создание Platform Inside",
  slug: "platform-inside",
  summary:
    "Путь от идеи до работающей Platform: продуктовые решения, архитектура и управляемый процесс поставки.",
} as const satisfies CollectionMetadataContract;

const playlistCatalog = [
  {
    ...platformPlaylistMetadata,
    totalCount: 8,
  },
  {
    name: "Решения, которые переживают код",
    slug: "engineering-decisions",
    summary: "Как принимать инженерные решения и оставлять проверяемый след.",
    totalCount: 6,
  },
  {
    name: "Основы поставки",
    slug: "delivery-basics",
    summary: "Короткий маршрут по качественной поставке изменений.",
    totalCount: 5,
  },
] as const satisfies readonly PlaylistCatalogFixture[];

const topicMaterials = [
  {
    access: "free",
    format: "Гайд",
    id: "material-product-boundary",
    posterLabel: "Связь задачи, аудитории и наблюдаемого результата",
    posterSteps: ["Задача", "Аудитория", "Результат"],
    series: [
      {
        id: "series-platform-inside",
        ordinal: 1,
        slug: "platform-inside",
        title: "Создание Platform Inside",
      },
    ],
    summary: "Как определить границы продукта до схемы данных и реализации.",
    tags: ["продукт", "границы"],
    title: "С чего начинается продуктовый контур",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "membership",
    format: "Гайд",
    id: "material-domain-language",
    posterLabel: "Маршрут от терминов продукта к проверяемым правилам",
    posterSteps: ["Термин", "Правило", "Проверка"],
    series: [
      {
        id: "series-platform-inside",
        ordinal: 2,
        slug: "platform-inside",
        title: "Создание Platform Inside",
      },
      {
        id: "series-engineering-decisions",
        ordinal: 1,
        slug: "engineering-decisions",
        title: "Решения, которые переживают код",
      },
    ],
    summary: "Собираем точный язык продукта до архитектурных решений.",
    tags: ["доменная модель", "термины"],
    title: "Доменная модель без преждевременной архитектуры",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "membership",
    duration: "38:42",
    format: "Видео",
    id: "material-delivery-pipeline",
    posterLabel: "Путь изменения от задачи до принятого результата",
    posterSteps: ["Задача", "Ветка", "Проверка", "Решение"],
    series: [
      {
        id: "series-platform-inside",
        ordinal: 4,
        slug: "platform-inside",
        title: "Создание Platform Inside",
      },
      {
        id: "series-delivery-basics",
        ordinal: 3,
        slug: "delivery-basics",
        title: "Основы поставки",
      },
    ],
    summary: "Связываем задачу, проверку и явное решение владельца.",
    tags: ["поставка", "процесс"],
    title: "Контур разработки и управляемая поставка",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "membership",
    format: "Гайд",
    id: "material-review-evidence",
    posterLabel: "Как доказательства превращают проверку в решение",
    posterSteps: ["Снимок", "Проверка", "Решение"],
    series: [
      {
        id: "series-engineering-decisions",
        ordinal: 3,
        slug: "engineering-decisions",
        title: "Решения, которые переживают код",
      },
    ],
    summary: "Какие доказательства нужны для технической и визуальной приёмки.",
    tags: ["приёмка", "качество"],
    title: "Приёмка, которой можно доверять",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "membership",
    duration: "27:10",
    format: "Видео",
    id: "material-release-boundary",
    posterLabel: "Граница между готовностью изменения и выпуском",
    posterSteps: ["Готово", "Решение", "Выпуск"],
    series: [
      {
        id: "series-platform-inside",
        ordinal: 5,
        slug: "platform-inside",
        title: "Создание Platform Inside",
      },
      {
        id: "series-delivery-basics",
        ordinal: 5,
        slug: "delivery-basics",
        title: "Основы поставки",
      },
    ],
    summary: "Почему готовность к слиянию и выпуск продукта требуют разных решений.",
    tags: ["выпуск", "решения"],
    title: "Готовность изменения — ещё не выпуск",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
] as const satisfies readonly MaterialPreviewFixture[];

const playlistMaterials = [
  {
    access: "Бесплатно",
    duration: "12 минут",
    format: "Гайд",
    slug: "platform-product-brief",
    summary: "Фиксируем аудиторию, границы продукта и наблюдаемый результат первой версии.",
    title: "С чего начинается продуктовый контур",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "Для участников",
    duration: "24 минуты",
    format: "Видео",
    slug: "platform-domain-language",
    summary: "Собираем точный язык продукта до схемы данных и интерфейсов.",
    title: "Доменная модель без преждевременной архитектуры",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "Для участников",
    duration: "18 минут",
    format: "Гайд",
    slug: "platform-agent-harness",
    summary: "Превращаем правила проекта в воспроизводимый рабочий процесс для агента.",
    title: "Как устроить разработку с агентами",
    topic: "Инженерия с ИИ",
    topicSlug: "ai-engineering",
  },
  {
    access: "Для участников",
    duration: "38 минут",
    format: "Видео",
    slug: "platform-developer-pipeline",
    summary: "Связываем задачу, проверку, pull request и явное решение владельца.",
    title: "Контур разработки и управляемая поставка",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "Для участников",
    duration: "27 минут",
    format: "Видео",
    slug: "platform-release-boundary",
    summary: "Разделяем готовность изменения, решение о слиянии и выпуск продукта.",
    title: "Готовность изменения — ещё не выпуск",
    topic: "Продуктовая разработка",
    topicSlug: "product-engineering",
  },
  {
    access: "Для участников",
    duration: "16 минут",
    format: "Гайд",
    slug: "platform-agent-context",
    summary: "Определяем, какие правила и факты нужны агенту для безопасной работы.",
    title: "Контекст проекта без информационного шума",
    topic: "Инженерия с ИИ",
    topicSlug: "ai-engineering",
  },
  {
    access: "Для участников",
    duration: "31 минута",
    format: "Видео",
    slug: "platform-agent-review",
    summary: "Отделяем реализацию от независимой проверки стандартов и требований.",
    title: "Как агенты проверяют работу друг друга",
    topic: "Инженерия с ИИ",
    topicSlug: "ai-engineering",
  },
  {
    access: "Для участников",
    duration: "14 минут",
    format: "Гайд",
    slug: "platform-agent-handoff",
    summary: "Сохраняем решения и доказательства так, чтобы следующая сессия продолжала работу.",
    title: "Передача контекста между сессиями",
    topic: "Инженерия с ИИ",
    topicSlug: "ai-engineering",
  },
] as const satisfies readonly PlaylistMaterialFixture[];

const baseTopic = buildTopicPresentationFixture(
  {
    name: "Продуктовая разработка",
    slug: "product-engineering",
    summary:
      "Проектирование продукта, архитектуры и процесса поставки как одной проверяемой системы.",
  },
  topicMaterials,
);

const basePlaylist = buildPlaylistPresentationFixture(
  platformPlaylistMetadata,
  playlistMaterials,
);

export function TopicPagePrototype({
  scenario = "populated",
}: TopicPagePrototypeProps) {
  const topic = getTopicFixture(scenario);

  return (
    <PrototypeShell>
      <div
        className="@container/collection min-w-0 max-w-[76rem]"
        data-collection-page="topic"
        data-collection-scenario={scenario}
      >
        <CollectionBreadcrumb current={topic.name} kind="Тема" />
        <TopicHeader topic={topic} />

        <section aria-labelledby="topic-playlists" className="mt-10 sm:mt-14">
          <SectionHeading
            countLabel={formatPlaylistCount(topic.playlists.length)}
            description="Маршруты, в которых есть материалы этой темы. Плейлист может продолжаться в других темах."
            id="topic-playlists"
            title="Плейлисты по теме"
          />
          {topic.playlists.length > 0 ? (
            <ul
              className="mt-5 grid max-w-[66rem] grid-cols-1 items-start gap-4 @min-[42rem]/collection:grid-cols-[repeat(auto-fill,minmax(18rem,20rem))]"
              role="list"
            >
              {topic.playlists.map((playlist) => (
                <li key={playlist.slug}>
                  <RelatedPlaylistCard playlist={playlist} />
                </li>
              ))}
            </ul>
          ) : (
            <InlineEmpty
              description="Когда материал темы войдёт в плейлист, маршрут появится здесь автоматически."
              title="Плейлистов по теме пока нет"
            />
          )}
        </section>

        <section aria-labelledby="topic-materials" className="mt-12 sm:mt-16">
          <SectionHeading
            countLabel={formatMaterialCount(topic.materials.length)}
            description="Все опубликованные материалы направления — без скрытого ограничения первой страницей каталога."
            id="topic-materials"
            title="Материалы"
          />
          {topic.materials.length > 0 ? (
            <ul
              className="mt-5 grid grid-cols-1 items-start gap-4 @min-[40rem]/collection:grid-cols-2 @min-[66rem]/collection:grid-cols-3"
              role="list"
            >
              {topic.materials.map((material) => (
                <li className="w-full max-w-[24rem]" key={material.id}>
                  <MaterialCard headingLevel="h3" material={material} />
                </li>
              ))}
            </ul>
          ) : (
            <InlineEmpty
              description="Опубликованные материалы появятся здесь автоматически."
              title="В теме пока нет материалов"
            />
          )}
        </section>
      </div>
    </PrototypeShell>
  );
}

export function PlaylistPagePrototype({
  scenario = "populated",
}: PlaylistPagePrototypeProps) {
  const playlist = getPlaylistFixture(scenario);

  return (
    <PrototypeShell>
      <div
        className="@container/collection min-w-0 max-w-[76rem]"
        data-collection-page="playlist"
        data-collection-scenario={scenario}
      >
        <CollectionBreadcrumb current={playlist.name} kind="Плейлист" />
        <PlaylistHeader playlist={playlist} />

        <section aria-labelledby="playlist-materials" className="mt-10 sm:mt-14">
          <SectionHeading
            countLabel={formatMaterialCount(playlist.materials.length)}
            description="Плейлист открывается целиком: переход из темы не скрывает материалы других направлений."
            id="playlist-materials"
            title="Материалы по порядку"
          />
          {playlist.materials.length > 0 ? (
            <ol className="mt-6 max-w-[68rem]" data-playlist-order>
              {playlist.materials.map((material, index) => (
                <PlaylistMaterialRow
                  index={index + 1}
                  key={material.slug}
                  material={material}
                />
              ))}
            </ol>
          ) : (
            <InlineEmpty
              description="Автор сможет добавить материалы и задать их порядок в админке."
              title="Плейлист пока пуст"
            />
          )}
        </section>
      </div>
    </PrototypeShell>
  );
}

function PrototypeShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApplicationShell
      accountLabel="Кирилл"
      currentPath="/library"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      {children}
    </ApplicationShell>
  );
}

function CollectionBreadcrumb({
  current,
  kind,
}: {
  readonly current: string;
  readonly kind: "Плейлист" | "Тема";
}) {
  return (
    <nav aria-label="Хлебные крошки">
      <ol className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <li>
          <Link
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 font-medium text-foreground no-underline hover:bg-muted focus-visible:outline-ring"
            href="/library"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            База знаний
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>{kind}</li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="max-w-[28ch] truncate text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}

function TopicHeader({ topic }: { readonly topic: TopicPageFixture }) {
  return (
    <header className="mt-5 grid gap-7 border-b border-border pb-8 sm:pb-10 @min-[52rem]/collection:grid-cols-[minmax(0,1fr)_22rem] @min-[52rem]/collection:items-end">
      <div className="min-w-0">
        <h1 className="max-w-[18ch] break-words text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-4xl">
          {topic.name}
        </h1>
        <p className="mt-4 max-w-[58ch] text-pretty leading-7 text-muted-foreground">
          {topic.summary}
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          {formatMaterialCount(topic.materials.length)} · {formatPlaylistCount(topic.playlists.length)}
        </p>
      </div>
      <TopicSystemArtwork />
    </header>
  );
}

function TopicSystemArtwork() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden min-h-52 overflow-clip rounded-2xl bg-sidebar text-sidebar-foreground @min-[18rem]/collection:block @min-[52rem]/collection:min-h-64"
    >
      <span className="absolute inset-x-7 top-7 h-px bg-sidebar-border" />
      <span className="absolute bottom-7 left-7 top-7 w-px bg-sidebar-border" />
      <span className="absolute right-7 top-6 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-sidebar-foreground/60">
        система
      </span>
      <span className="absolute inset-x-8 top-1/2 grid -translate-y-1/2 grid-cols-3 items-center gap-2">
        {[
          ["Задача", "01"],
          ["Проверка", "02"],
          ["Решение", "03"],
        ].map(([label, number], index) => (
          <span
            className="relative grid min-h-20 place-items-center rounded-xl border border-sidebar-border bg-sidebar px-2 text-center text-xs font-semibold text-sidebar-foreground"
            key={label}
          >
            <span className="font-mono text-[0.6875rem] text-sidebar-foreground/80">{number}</span>
            {label}
            {index < 2 ? (
              <span className="absolute left-full top-1/2 h-px w-2 bg-sidebar-primary" />
            ) : null}
          </span>
        ))}
      </span>
    </div>
  );
}

function PlaylistHeader({ playlist }: { readonly playlist: PlaylistPageFixture }) {
  return (
    <header className="mt-5 border-b border-border pb-8 sm:pb-10">
      <div className="grid gap-7 @min-[58rem]/collection:grid-cols-[minmax(0,1fr)_18rem] @min-[58rem]/collection:items-end">
        <div className="min-w-0">
          <div className="grid size-12 place-items-center rounded-xl bg-sidebar text-sidebar-primary">
            <ListVideo aria-hidden="true" className="size-5" />
          </div>
          <h1 className="mt-6 max-w-[20ch] break-words text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-4xl">
            {playlist.name}
          </h1>
          <p className="mt-4 max-w-[62ch] text-pretty leading-7 text-muted-foreground">
            {playlist.summary}
          </p>
        </div>
        <div className="min-w-0 @min-[58rem]/collection:border-l @min-[58rem]/collection:border-border @min-[58rem]/collection:pl-6">
          <p className="font-mono text-xs text-muted-foreground">
            {formatMaterialCount(playlist.materials.length)}
          </p>
          {playlist.topics.length > 0 ? (
            <nav aria-label="Темы плейлиста" className="mt-4">
              <ul className="flex flex-wrap gap-2" role="list">
                {playlist.topics.map((topic) => (
                  <li key={topic.slug}>
                    <Link
                      className="inline-flex min-h-10 items-center rounded-xl bg-muted px-3 py-2 text-sm font-semibold text-foreground no-underline hover:bg-secondary focus-visible:outline-ring"
                      href={`/topics/${topic.slug}`}
                    >
                      {topic.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function SectionHeading({
  countLabel,
  description,
  id,
  title,
}: {
  readonly countLabel: string;
  readonly description: string;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <div className="flex max-w-[68rem] flex-col justify-between gap-3 @min-[48rem]/collection:flex-row @min-[48rem]/collection:items-end">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.03em]" id={id}>
          {title}
        </h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{countLabel}</p>
      </div>
      <p className="max-w-[56ch] text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function RelatedPlaylistCard({
  playlist,
}: {
  readonly playlist: RelatedPlaylistFixture;
}) {
  return (
    <Link
      className="group/playlist flex min-h-52 flex-col rounded-2xl bg-card p-5 text-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none"
      data-related-playlist
      href={`/series/${playlist.slug}`}
    >
      <span className="flex items-start justify-between gap-4">
        <span className="grid size-10 place-items-center rounded-xl bg-sidebar text-sidebar-primary">
          <ListVideo aria-hidden="true" className="size-4.5" />
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-5 text-muted-foreground transition-transform group-hover/playlist:-translate-y-0.5 group-hover/playlist:translate-x-0.5 motion-reduce:transform-none"
        />
      </span>
      <span className="mt-5 block text-lg font-semibold leading-6 tracking-[-0.025em]">
        {playlist.name}
      </span>
      <span className="mt-2 block text-sm leading-5 text-muted-foreground">
        {playlist.summary}
      </span>
      <span className="mt-auto block pt-5 font-mono text-[0.6875rem] text-muted-foreground">
        {playlist.matchingCount} по этой теме · {playlist.totalCount} всего
      </span>
    </Link>
  );
}

function PlaylistMaterialRow({
  index,
  material,
}: {
  readonly index: number;
  readonly material: PlaylistMaterialFixture;
}) {
  return (
    <li
      className="group/row grid border-t border-border first:border-t-0 @min-[42rem]/collection:grid-cols-[5.5rem_minmax(0,1fr)]"
      data-playlist-ordinal={index}
    >
      <div className="flex items-center gap-3 py-4 font-mono text-xs text-muted-foreground @min-[42rem]/collection:items-start @min-[42rem]/collection:pt-7">
        <span className="grid size-9 place-items-center rounded-full bg-sidebar text-sidebar-primary">
          {index}
        </span>
        <Play aria-hidden="true" className="size-3.5 @min-[42rem]/collection:mt-3" />
      </div>
      <Link
        className="grid min-w-0 gap-4 rounded-xl px-0 pb-6 pt-1 text-foreground no-underline focus-visible:outline-ring @min-[42rem]/collection:grid-cols-[minmax(0,1fr)_auto] @min-[42rem]/collection:px-4 @min-[42rem]/collection:py-6"
        href={`/materials/${material.slug}`}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 font-semibold text-foreground">
              {material.format === "Видео" ? (
                <Play aria-hidden="true" className="size-3" />
              ) : (
                <BookOpenText aria-hidden="true" className="size-3" />
              )}
              {material.format}
            </span>
            <span>{material.access}</span>
            {material.duration === undefined ? null : (
              <span className="inline-flex items-center gap-1">
                <Clock3 aria-hidden="true" className="size-3" />
                {material.duration}
              </span>
            )}
          </span>
          <span className="mt-3 block max-w-[40ch] text-lg font-semibold leading-6 tracking-[-0.025em] @min-[56rem]/collection:text-xl">
            {material.title}
          </span>
          <span className="mt-2 block max-w-[62ch] text-sm leading-6 text-muted-foreground">
            {material.summary}
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-between gap-3 self-end @min-[42rem]/collection:self-start">
          <span
            className="max-w-48 truncate rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-semibold"
            title={material.topic}
          >
            {material.topic}
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground transition-transform group-hover/row:-translate-y-0.5 group-hover/row:translate-x-0.5 motion-reduce:transform-none"
          />
        </span>
      </Link>
    </li>
  );
}

function InlineEmpty({
  description,
  title,
}: {
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="mt-5 max-w-[42rem] border-y border-border py-7">
      <h3 className="text-lg font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 max-w-[56ch] text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function getTopicFixture(scenario: CollectionScenario): TopicPageFixture {
  if (scenario === "empty") {
    return buildTopicPresentationFixture(baseTopic, []);
  }
  if (scenario === "sparse") {
    return buildTopicPresentationFixture(baseTopic, [topicMaterials[0]]);
  }
  if (scenario === "long-title") {
    return {
      ...baseTopic,
      summary:
        "Материалы о проектировании продукта, архитектуры, качества и процесса поставки в распределённых инженерных командах.",
      name: "Продуктовая разработка в сложных распределённых системах",
    };
  }
  return baseTopic;
}

function getPlaylistFixture(scenario: CollectionScenario): PlaylistPageFixture {
  if (scenario === "empty") {
    return buildPlaylistPresentationFixture(basePlaylist, []);
  }
  if (scenario === "sparse") {
    return buildPlaylistPresentationFixture(basePlaylist, [playlistMaterials[0]]);
  }
  if (scenario === "long-title") {
    return {
      ...basePlaylist,
      name:
        "Как спроектировать, собрать и безопасно запустить платформу с базой знаний",
    };
  }
  return basePlaylist;
}

/**
 * Prototype stand-ins for the production application adapter. React receives a complete
 * presentation model and never owns collection policy or relationship aggregation.
 */
function buildTopicPresentationFixture(
  metadata: CollectionMetadataContract,
  materials: readonly MaterialPreviewFixture[],
): TopicPageFixture {
  return {
    ...metadata,
    materials,
    playlists: getRelatedPlaylists(materials),
  };
}

function buildPlaylistPresentationFixture(
  metadata: CollectionMetadataContract,
  materials: readonly PlaylistMaterialFixture[],
): PlaylistPageFixture {
  return {
    ...metadata,
    materials,
    topics: getPlaylistTopics(materials),
  };
}

function getRelatedPlaylists(
  materials: readonly MaterialPreviewFixture[],
): readonly RelatedPlaylistFixture[] {
  const matchingCounts = new Map<string, number>();
  for (const material of materials) {
    for (const membership of material.series) {
      matchingCounts.set(
        membership.slug,
        (matchingCounts.get(membership.slug) ?? 0) + 1,
      );
    }
  }

  return playlistCatalog.flatMap((playlist) => {
    const matchingCount = matchingCounts.get(playlist.slug);
    return matchingCount === undefined ? [] : [{ ...playlist, matchingCount }];
  });
}

function getPlaylistTopics(
  materials: readonly PlaylistMaterialFixture[],
): readonly { readonly name: string; readonly slug: string }[] {
  const topics = new Map<string, string>();
  for (const material of materials) {
    if (!topics.has(material.topicSlug)) {
      topics.set(material.topicSlug, material.topic);
    }
  }

  return [...topics].map(([slug, name]) => ({ name, slug }));
}

function formatMaterialCount(count: number) {
  return formatCount(count, "материал", "материала", "материалов");
}

function formatPlaylistCount(count: number) {
  return formatCount(count, "плейлист", "плейлиста", "плейлистов");
}

function formatCount(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;

  return `${String(count)} ${noun}`;
}
