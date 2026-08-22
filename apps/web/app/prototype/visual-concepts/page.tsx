import type { Metadata } from "next";
import { IBM_Plex_Mono, Literata, Manrope, Onest } from "next/font/google";

import { PrototypeSwitcher } from "./prototype-switcher";
import styles from "./visual-concepts.module.css";

// Three Library concepts, switchable via ?variant=, on the throwaway /prototype/visual-concepts route.

const manrope = Manrope({ subsets: ["cyrillic", "latin"], variable: "--font-manrope" });
const onest = Onest({ subsets: ["cyrillic", "latin"], variable: "--font-onest" });
const plexMono = IBM_Plex_Mono({
  subsets: ["cyrillic", "latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});
const literata = Literata({ subsets: ["cyrillic", "latin"], variable: "--font-literata" });

export const metadata: Metadata = {
  title: "Visual concepts · Inside Platform prototype",
  robots: { index: false, follow: false },
};

const materials = [
  {
    access: "free",
    format: "Гайд",
    id: "material-public-agent-skills",
    series: null,
    seriesOrdinal: null,
    summary:
      "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию, которую человек и агент выполняют одинаково.",
    tags: ["agent skills", "harness", "engineering workflow"],
    title: "Публичные skills для agent-first setup",
    topic: "AI-first engineering",
  },
  {
    access: "membership",
    format: "Видео · 38:42",
    id: "material-platform-build-05",
    series: "Создание Platform Inside",
    seriesOrdinal: 5,
    summary:
      "Разбираем, как связать issue, task branch, evidence, pull request и явный owner GO в один проверяемый delivery flow.",
    tags: ["platform build", "developer pipeline", "harness"],
    title: "Создание Platform Inside — 5. Developer Pipeline и owner-controlled delivery",
    topic: "Product engineering",
  },
  {
    access: "membership",
    format: "Видео",
    id: "material-career-resume",
    series: null,
    seriesOrdinal: null,
    summary:
      "Практический разбор воронки поиска, структуры резюме и проверки гипотез без массовых безадресных откликов.",
    tags: ["job search", "resume"],
    title: "Гайд на поиск работы и резюме в IT",
    topic: "Карьера",
  },
] as const;

const variants = ["workshop", "atlas", "studio"] as const;
const topicFacets = ["product", "ai", "career"] as const;
const formatFacets = ["video", "guide"] as const;
const seriesFacets = ["platform"] as const;
type Variant = (typeof variants)[number];
type LibraryState = "results" | "empty";
type Material = (typeof materials)[number];
type TopicFacet = (typeof topicFacets)[number];
type FormatFacet = (typeof formatFacets)[number];
type SeriesFacet = (typeof seriesFacets)[number];
type Facets = Readonly<{
  topic: readonly TopicFacet[];
  format: readonly FormatFacet[];
  series: readonly SeriesFacet[];
}>;

type PageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

type VariantProps = Readonly<{
  facets: Facets;
  materials: readonly Material[];
  query: string;
  state: LibraryState;
}>;

function resultLabel(count: number) {
  if (count === 1) return "1 материал";
  if (count > 1 && count < 5) return `${count} материала`;
  return `${count} материалов`;
}

function activeFacetLabel(facets: Facets) {
  const count = facets.topic.length + facets.format.length + facets.series.length;
  if (count === 0) return "Фильтры не выбраны";
  if (count === 1) return "Выбран 1 фильтр";
  return `Выбрано ${count} фильтра`;
}

function PrototypeParams({ facets, variant }: Readonly<{ facets: Facets; variant: Variant }>) {
  return (
    <>
      <input name="variant" type="hidden" value={variant} />
      <input name="state" type="hidden" value="results" />
      {facets.topic.map((value) => <input key={value} name="topic" type="hidden" value={value} />)}
      {facets.format.map((value) => <input key={value} name="format" type="hidden" value={value} />)}
      {facets.series.map((value) => <input key={value} name="series" type="hidden" value={value} />)}
    </>
  );
}

function FacetFields({ facets }: Readonly<{ facets: Facets }>) {
  return (
    <>
      <fieldset>
        <legend>Тема</legend>
        <label><input defaultChecked={facets.topic.includes("product")} name="topic" type="checkbox" value="product" /> Product engineering</label>
        <label><input defaultChecked={facets.topic.includes("ai")} name="topic" type="checkbox" value="ai" /> AI-first engineering</label>
        <label><input defaultChecked={facets.topic.includes("career")} name="topic" type="checkbox" value="career" /> Карьера</label>
      </fieldset>
      <fieldset>
        <legend>Формат</legend>
        <label><input defaultChecked={facets.format.includes("video")} name="format" type="checkbox" value="video" /> Видео</label>
        <label><input defaultChecked={facets.format.includes("guide")} name="format" type="checkbox" value="guide" /> Гайд</label>
      </fieldset>
      <fieldset>
        <legend>Серия</legend>
        <label><input defaultChecked={facets.series.includes("platform")} name="series" type="checkbox" value="platform" /> Создание Platform Inside</label>
      </fieldset>
    </>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="10.75" cy="10.75" fill="none" r="6.75" stroke="currentColor" strokeWidth="1.75" />
      <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
    </svg>
  );
}

function MarkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <path d="M8 8h16v16H8z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11 20 4-8 3 6 3-5" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.75" />
      <circle cx="23.5" cy="8.5" fill="currentColor" r="3.5" />
    </svg>
  );
}

function EmptyState({ className, variant }: Readonly<{ className: string; variant: Variant }>) {
  return (
    <section aria-labelledby="empty-title" className={className}>
      <svg aria-hidden="true" viewBox="0 0 80 80">
        <path d="M14 24h52M14 40h38M14 56h24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        <circle cx="62" cy="54" fill="none" r="10" stroke="currentColor" strokeWidth="2" />
        <path d="m69 61 7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
      <div>
        <h2 id="empty-title">Ничего не найдено</h2>
        <p>Измените запрос или сбросьте фильтры.</p>
      </div>
      <form method="get">
        <input name="variant" type="hidden" value={variant} />
        <input name="state" type="hidden" value="results" />
        <button type="submit">Сбросить поиск и фильтры</button>
      </form>
    </section>
  );
}

export function WorkshopVariant({ facets, materials: visibleMaterials, query }: VariantProps) {
  return (
    <div className={styles.workshop}>
      <a className={styles.skipLink} href="#workshop-content">К результатам</a>
      <aside className={styles.workshopRail}>
        <a aria-label="Inside, Главная" className={styles.workshopMark} href="#">
          <MarkIcon />
        </a>
        <nav aria-label="Основная навигация">
          <a href="#">Главная</a>
          <a aria-current="page" href="#workshop-content">Библиотека</a>
          <a href="#">Карта</a>
        </nav>
        <a className={styles.workshopAccount} href="#">KS</a>
      </aside>

      <div className={styles.workshopShell}>
        <header className={styles.workshopHeader}>
          <a href="#">Inside Platform</a>
          <p><span /> Открытые материалы и контент Мастерской</p>
          <a href="#">Кирилл</a>
        </header>

        <main className={styles.workshopMain} id="workshop-content">
          <section className={styles.workshopIntro}>
            <div>
              <h1>Найдите материал для текущей задачи</h1>
              <p>Практика, решения и артефакты — без обязательного маршрута.</p>
            </div>
            <form className={styles.workshopSearch} method="get">
              <PrototypeParams facets={facets} variant="workshop" />
              <label htmlFor="workshop-query">Поиск по Библиотеке</label>
              <div>
                <SearchIcon />
                <input defaultValue={query} id="workshop-query" name="q" placeholder="Навык, тема или артефакт" />
                <button type="submit">Найти</button>
              </div>
            </form>
          </section>

          <form aria-label="Фильтры" className={styles.workshopFilters} method="get">
            <input name="variant" type="hidden" value="workshop" />
            <input name="state" type="hidden" value="results" />
            {query && <input name="q" type="hidden" value={query} />}
            <p>Уточнить поиск <span>{activeFacetLabel(facets)}</span></p>
            <FacetFields facets={facets} />
            <div>
              <button type="submit">Применить</button>
              <a href="?variant=workshop&state=results">Сбросить</a>
            </div>
          </form>

          <section aria-labelledby="workshop-results">
            <div className={styles.workshopResultsHeading}>
              <h2 id="workshop-results">Материалы</h2>
              <p aria-live="polite">{resultLabel(visibleMaterials.length)}</p>
            </div>
            {visibleMaterials.length === 0 ? (
              <EmptyState className={styles.workshopEmpty} variant="workshop" />
            ) : (
              <ul className={styles.workshopResults}>
                {visibleMaterials.map((material, index) => (
                  <li key={material.id}>
                    <article>
                      <div className={styles.workshopSignal}>
                        <span>{index === 1 ? "Сейчас" : material.access === "free" ? "Открыто" : "В Мастерской"}</span>
                      </div>
                      <div className={styles.workshopMaterial}>
                        <p>{material.topic} · {material.format}</p>
                        <h3><a href="#">{material.title}</a></h3>
                        <p>{material.summary}</p>
                        <ul aria-label="Теги">
                          {material.tags.map((tag) => <li key={tag}>{tag}</li>)}
                        </ul>
                      </div>
                      {material.series ? (
                        <aside>
                          <p>В серии</p>
                          <strong>{material.series}</strong>
                          <span>Выпуск {material.seriesOrdinal}</span>
                        </aside>
                      ) : (
                        <div aria-hidden="true" className={styles.workshopArtifact}>
                          <span />
                          <span />
                          <span />
                        </div>
                      )}
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

export function AtlasVariant({ facets, materials: visibleMaterials, query }: VariantProps) {
  return (
    <div className={styles.atlas}>
      <a className={styles.skipLink} href="#atlas-content">К результатам</a>
      <header className={styles.atlasHeader}>
        <a className={styles.atlasBrand} href="#"><MarkIcon /> <span>Inside</span></a>
        <nav aria-label="Основная навигация">
          <a href="#">Главная</a>
          <a aria-current="page" href="#atlas-content">Библиотека</a>
          <a href="#">Карта</a>
        </nav>
        <a className={styles.atlasAccount} href="#">Кирилл <span>KS</span></a>
      </header>

      <main className={styles.atlasMain} id="atlas-content">
        <section className={styles.atlasIntro}>
          <h1>Соберите маршрут из связанных материалов</h1>
          <form method="get">
            <PrototypeParams facets={facets} variant="atlas" />
            <SearchIcon />
            <label className={styles.visuallyHidden} htmlFor="atlas-query">Поиск по Библиотеке</label>
            <input defaultValue={query} id="atlas-query" name="q" placeholder="Навык, тема или артефакт" />
            <button type="submit">Найти</button>
          </form>
          <p>Ищем по названию, тексту, Темам, Сериям и артефактам.</p>
        </section>

        <section className={styles.atlasWorkspace}>
          <aside className={styles.atlasPaths}>
            <div className={styles.atlasPathsHeading}>
              <h2>Контекст поиска</h2>
              <a href="?variant=atlas&state=results">Сбросить</a>
            </div>
            <nav aria-label="Связи материалов">
              <a className={styles.atlasNodeRoot} href="#">Product engineering</a>
              <div className={styles.atlasBranch}>
                <a aria-current="true" href="#">Developer Pipeline</a>
                <a href="#">Создание Platform Inside</a>
              </div>
              <a href="#">AI-first engineering</a>
              <a href="#">Карьера</a>
            </nav>
            <svg aria-hidden="true" className={styles.atlasMap} viewBox="0 0 280 150">
              <path d="M15 32h58c25 0 22 37 47 37h48c22 0 20 48 43 48h54" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="15" cy="32" r="5" />
              <circle cx="120" cy="69" r="5" />
              <circle cx="211" cy="117" r="5" />
              <circle cx="265" cy="117" r="5" />
            </svg>
          </aside>

          <section aria-labelledby="atlas-results" className={styles.atlasResultsRegion}>
            <div className={styles.atlasResultsHeading}>
              <div>
                <h2 id="atlas-results">Связанные материалы</h2>
                <p>{resultLabel(visibleMaterials.length)} · {activeFacetLabel(facets)}</p>
              </div>
              <details>
                <summary>Тема, Формат и Серия</summary>
                <form method="get">
                  <input name="variant" type="hidden" value="atlas" />
                  <input name="state" type="hidden" value="results" />
                  {query && <input name="q" type="hidden" value={query} />}
                  <FacetFields facets={facets} />
                  <div>
                    <button type="submit">Применить</button>
                    <a href="?variant=atlas&state=results">Сбросить</a>
                  </div>
                </form>
              </details>
            </div>

            {visibleMaterials.length === 0 ? (
              <EmptyState className={styles.atlasEmpty} variant="atlas" />
            ) : (
              <ul className={styles.atlasResults}>
                {visibleMaterials.map((material, index) => (
                  <li key={material.id}>
                    <article>
                      <div className={styles.atlasRouteMark} aria-hidden="true"><span>{index + 1}</span></div>
                      <div>
                        <p className={styles.atlasMetadata}>
                          <span>{material.access === "free" ? "Открыто" : "В Мастерской"}</span>
                          {material.topic} · {material.format}
                        </p>
                        <h3><a href="#">{material.title}</a></h3>
                        <p>{material.summary}</p>
                        <div className={styles.atlasRelations}>
                          {material.series && <a href="#">Серия: {material.series} · выпуск {material.seriesOrdinal}</a>}
                          {material.tags.map((tag) => <a href="#" key={tag}>{tag}</a>)}
                        </div>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

export function StudioVariant({ facets, materials: visibleMaterials, query }: VariantProps) {
  return (
    <div className={styles.studio}>
      <a className={styles.skipLink} href="#studio-content">К результатам</a>
      <header className={styles.studioHeader}>
        <a className={styles.studioBrand} href="#">Sachkov <i /> Inside</a>
        <nav aria-label="Основная навигация">
          <a href="#">Главная</a>
          <a aria-current="page" href="#studio-content">Библиотека</a>
          <a href="#">Карта</a>
        </nav>
        <a className={styles.studioAccount} href="#">Кабинет</a>
      </header>

      <main className={styles.studioMain} id="studio-content">
        <section className={styles.studioIntro}>
          <div>
            <h1>Библиотека</h1>
            <p>Полные материалы о разработке продуктов, решениях и живом процессе сборки.</p>
          </div>
          <p>Свободный доступ<br /><span>и контент Мастерской</span></p>
        </section>

        <form className={styles.studioSearch} method="get">
          <PrototypeParams facets={facets} variant="studio" />
          <SearchIcon />
          <label className={styles.visuallyHidden} htmlFor="studio-query">Поиск по Библиотеке</label>
          <input defaultValue={query} id="studio-query" name="q" placeholder="Навык, тема или артефакт" />
          <button type="submit">Искать</button>
        </form>

        <form aria-label="Фильтры" className={styles.studioTools} method="get">
          <input name="variant" type="hidden" value="studio" />
          <input name="state" type="hidden" value="results" />
          {query && <input name="q" type="hidden" value={query} />}
          <div><strong>{activeFacetLabel(facets)}</strong><FacetFields facets={facets} /></div>
          <div>
            <button type="submit">Применить</button>
            <a href="?variant=studio&state=results">Сбросить</a>
          </div>
        </form>

        <section aria-labelledby="studio-results" className={styles.studioResultsRegion}>
          <div className={styles.studioResultsHeading}>
            <h2 id="studio-results">По вашему запросу</h2>
            <p aria-live="polite">{resultLabel(visibleMaterials.length)}</p>
          </div>
          {visibleMaterials.length === 0 ? (
            <EmptyState className={styles.studioEmpty} variant="studio" />
          ) : (
            <ul className={styles.studioResults}>
              {visibleMaterials.map((material) => (
                <li key={material.id}>
                  <article>
                    <div className={styles.studioAccess}>
                      <span>{material.access === "free" ? "Свободный доступ" : "Мастерская"}</span>
                      <p>{material.format}</p>
                    </div>
                    <div className={styles.studioMaterial}>
                      <h3><a href="#">{material.title}</a></h3>
                      <p>{material.summary}</p>
                      <ul aria-label="Теги">
                        {material.tags.map((tag) => <li key={tag}><a href="#">{tag}</a></li>)}
                      </ul>
                    </div>
                    <aside>
                      <p>{material.topic}</p>
                      {material.series && <p>{material.series} · выпуск {material.seriesOrdinal}</p>}
                      <a href="#">Открыть материал</a>
                    </aside>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getFacetParams<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): readonly T[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((candidate): candidate is T => allowed.includes(candidate as T)))];
}

export default async function VisualConceptsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedVariant = getSingleParam(params.variant);
  const requestedState = getSingleParam(params.state);
  const query = getSingleParam(params.q)?.trim() ?? "";
  const variant: Variant = variants.includes(requestedVariant as Variant)
    ? (requestedVariant as Variant)
    : "workshop";
  const state: LibraryState = requestedState === "empty" ? "empty" : "results";
  const facets: Facets = {
    topic: getFacetParams(params.topic, topicFacets),
    format: getFacetParams(params.format, formatFacets),
    series: getFacetParams(params.series, seriesFacets),
  };
  const normalizedQuery = query.toLocaleLowerCase("ru");
  const filteredMaterials = materials.filter((material) => {
    const matchesQuery = normalizedQuery.length === 0 || [
      material.title,
      material.summary,
      material.topic,
      material.format,
      material.series ?? "",
      ...material.tags,
    ].join(" ").toLocaleLowerCase("ru").includes(normalizedQuery);

    const matchesTopic = facets.topic.length === 0 || facets.topic.some((facet) => ({
      ai: "AI-first engineering",
      career: "Карьера",
      product: "Product engineering",
    })[facet] === material.topic);
    const matchesFormat = facets.format.length === 0 || facets.format.some((facet) => (
      facet === "video" ? material.format.startsWith("Видео") : material.format === "Гайд"
    ));
    const matchesSeries = facets.series.length === 0 || facets.series.some((facet) => (
      facet === "platform" && material.series === "Создание Platform Inside"
    ));

    return matchesQuery && matchesTopic && matchesFormat && matchesSeries;
  });
  const visibleMaterials = state === "empty" ? [] : filteredMaterials;
  const fontClasses = [
    onest.variable,
    plexMono.variable,
    variant === "workshop" ? manrope.variable : "",
    variant === "studio" ? literata.variable : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={fontClasses}>
      {variant === "workshop" && <WorkshopVariant facets={facets} materials={visibleMaterials} query={query} state={state} />}
      {variant === "atlas" && <AtlasVariant facets={facets} materials={visibleMaterials} query={query} state={state} />}
      {variant === "studio" && <StudioVariant facets={facets} materials={visibleMaterials} query={query} state={state} />}
      <PrototypeSwitcher current={variant} state={state} />
    </div>
  );
}
