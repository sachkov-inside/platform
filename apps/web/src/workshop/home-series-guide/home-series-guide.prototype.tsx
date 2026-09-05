/* eslint-disable next/no-img-element -- Storybook-only static cover fixtures; no Next image server. */
"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  FileDown,
  LockKeyhole,
  Play,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { HomePage } from "@/_pages/home";
import { HomeHub, HubLibrary, HubNote } from "./home-hub.prototype";
import { proofSeries } from "./series-order.fixture";
import { hubFixture } from "./hub.fixture";
import { Button } from "@/shared/ui/button";
import {
  ApplicationShell,
  PublicProductHeader,
} from "@/widgets/application-shell";
import { episodes, guides } from "./content.fixture";
import "./home-series-guide.prototype.css";

/** THROWAWAY #290: main Home hub extended with series and membership; main composition as reference; no production data. */
type Screen =
  | "home"
  | "videos"
  | "guides"
  | "video"
  | "a"
  | "b"
  | "tag"
  | "membership"
  | "profile"
  | "review"
  | "library"
  | "note";
type Variant = "A" | "B";
type SeriesContext = "guides" | "review" | "videos" | "none";
const screens: readonly string[] = [
  "home",
  "videos",
  "guides",
  "video",
  "a",
  "b",
  "tag",
  "membership",
  "profile",
  "review",
  "library",
  "note",
];
const guideSeries = "Как организовать harness для проекта";
const cover = (index: number) =>
  `/api/content-covers/27100000-0000-4000-8000-${String(index).padStart(12, "0")}/960`;

export function HomeSeriesGuidePrototype({
  initialVariant = "A",
  initialScreen = "home",
  initialMember = false,
}: {
  readonly initialVariant?: Variant;
  readonly initialScreen?: Screen;
  readonly initialMember?: boolean;
}) {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [member, setMember] = useState(initialMember);
  const [context, setContext] = useState<SeriesContext>("none");
  const [episode, setEpisode] = useState(5);
  const [copied, setCopied] = useState(false);
  const [catalog, setCatalog] = useState({
    format: "",
    topic: "",
    view: "",
    note: "",
  });
  const home = hubFixture(member);
  const materialSamples = [...home.guides, ...home.videos, ...home.notes];
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search);
      setVariant(
        query.get("variant") === "B"
          ? "B"
          : query.get("variant") === "A"
            ? "A"
            : initialVariant,
      );
      const next = query.get("screen");
      setScreen(
        next && screens.includes(next) ? (next as Screen) : initialScreen,
      );
      setCatalog({
        format: query.get("format") ?? "",
        topic: query.get("topic") ?? "",
        view: query.get("view") ?? "",
        note: query.get("note") ?? "",
      });
      setMember(
        query.has("member") ? query.get("member") === "1" : initialMember,
      );
      const source = query.get("series");
      const targetScreen = next ?? initialScreen;
      const materialSlug =
        targetScreen === "a"
          ? "guide-a"
          : targetScreen === "b"
            ? "guide-b"
            : targetScreen === "video"
              ? `episode-${query.get("episode") ?? "5"}`
              : (query.get("note") ?? "");
      const selected =
        source === "guides" || source === "review" || source === "videos"
          ? source
          : "none";
      setContext(
        selected !== "none" &&
          (["a", "b", "video", "note"].includes(targetScreen)
            ? (
                proofSeries[selected].materialSlugs as readonly string[]
              ).includes(materialSlug)
            : true)
          ? selected
          : "none",
      );
      const number = Number(query.get("episode"));
      setEpisode(
        Number.isInteger(number) && number >= 1 && number <= 8 ? number : 5,
      );
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
    };
  }, [initialMember, initialScreen, initialVariant]);

  useEffect(() => {
    setCopied(false);
    const main = root.current?.querySelector("main");
    main?.scrollTo(0, 0);
    window.scrollTo(0, 0);
    root.current
      ?.querySelector<HTMLElement>("h1")
      ?.focus({ preventScroll: true });
  }, [screen, variant, episode, catalog.note]);

  function href(next: Screen, changes: Record<string, string> = {}) {
    const query = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    query.set("variant", variant);
    query.set("screen", next);
    query.set("member", member ? "1" : "0");
    query.set("series", context);
    query.set("episode", String(episode));
    Object.entries(changes).forEach(([key, value]) => {
      query.set(key, value);
    });
    return `?${query.toString()}`;
  }

  function navigate(url: string) {
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function intercept(event: MouseEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor || anchor.hasAttribute("download")) return;
    const target = anchor.getAttribute("href");
    if (
      target?.startsWith("/library") ||
      target?.startsWith("/topics/") ||
      target?.startsWith("/series/") ||
      target?.startsWith("/materials/")
    ) {
      const url = new URL(target, window.location.origin);
      const slug = url.pathname.split("/")[2] ?? "";
      event.preventDefault();
      if (url.pathname.startsWith("/series/"))
        navigate(
          href(
            slug === "development"
              ? "videos"
              : slug === "review"
                ? "review"
                : "guides",
          ),
        );
      else if (url.pathname.startsWith("/materials/")) {
        if (slug.startsWith("episode-"))
          navigate(href("video", { episode: slug.slice(8), series: "none" }));
        else if (slug === "guide-a" || slug === "guide-b")
          navigate(href(slug === "guide-a" ? "a" : "b", { series: "none" }));
        else navigate(href("note", { note: slug, series: "none" }));
      } else
        navigate(
          href("library", {
            format: url.searchParams.get("format") ?? "",
            topic: url.pathname.startsWith("/topics/")
              ? slug
              : (url.searchParams.get("topic") ?? ""),
            view: url.searchParams.get("view") ?? "",
          }),
        );
      return;
    }
    const shellTarget =
      target === "/"
        ? "home"
        : target === "/library"
          ? "tag"
          : target === "/account"
            ? "profile"
            : null;
    if (target && (target.startsWith("?") || shellTarget)) {
      event.preventDefault();
      navigate(shellTarget ? href(shellTarget) : target);
    }
  }

  function Link({
    to,
    children,
    primary = false,
    changes = {},
  }: {
    readonly to: Screen;
    readonly children: ReactNode;
    readonly primary?: boolean;
    readonly changes?: Record<string, string>;
  }) {
    return (
      <Button
        asChild
        variant={primary ? "default" : "outline"}
        className="h-auto min-h-11 whitespace-normal rounded-full px-5 py-3 text-left"
      >
        <a href={href(to, changes)}>
          {children}
          <ArrowRight aria-hidden="true" />
        </a>
      </Button>
    );
  }

  function Subscription() {
    return (
      <section
        className="hsg-subscription"
        aria-labelledby="subscription-title"
      >
        <div>
          <p className="hsg-eyebrow">Подписка Inside</p>
          <h2 id="subscription-title">
            Материалы, контекст и разговор с инженерами
          </h2>
          <p>
            Разборы реальной разработки, связанные серии и авторские артефакты.
            Обсуждение материалов и рабочих решений — в закрытом
            Telegram-пространстве.
          </p>
        </div>
        <div>
          <ul>
            <li>Полные материалы и связанные ресурсы</li>
            <li>Production- и AI-first практики</li>
            <li>Обсуждение с автором и участниками</li>
          </ul>
          {screen !== "membership" && (
            <Link to="membership">Что входит в подписку</Link>
          )}
        </div>
      </section>
    );
  }

  function Home() {
    return variant === "B" ? (
      <HomePage
        result={{
          kind: "ready",
          value: { ...home, videos: home.videos.slice(0, 3) },
        }}
      />
    ) : (
      <HomeHub
        home={home}
        member={member}
        membershipHref={href("membership")}
      />
    );
  }

  function Related({ step }: { readonly step: "a" | "b" }) {
    return (
      <aside
        className="hsg-related"
        aria-label={`Необязательный разбор к шагу ${step === "a" ? "1" : "2"}`}
      >
        <p className="hsg-eyebrow">Необязательно · связанный разбор</p>
        {step === "a" ? (
          <>
            <h3>Как harness настраивался в Inside</h3>
            <p>
              Выпуск 5 · 26:32. Связь предложена по описанию записи в Telegram:
              содержимое ещё не проверено, таймкод не выбран. Гайд можно пройти
              без видео.
            </p>
            <Link to="video" changes={{ episode: "5", series: "none" }}>
              Открыть видеоразбор
            </Link>
          </>
        ) : (
          <>
            <h3>Почему небольшое изменение проще проверить</h3>
            <p>
              Иллюстративная заметка из main. Дополнение к проверке результата;
              не следующий обязательный шаг.
            </p>
            <Link
              to="note"
              changes={{ note: "proveryaemaya-postavka", series: "none" }}
            >
              Открыть заметку
            </Link>
          </>
        )}
      </aside>
    );
  }

  function Series() {
    const video = screen === "videos";
    return (
      <>
        <Back to="home">На главную</Back>
        <header className="hsg-series-header">
          <div>
            <p className="hsg-eyebrow">
              {video
                ? "Серия · видеодневник из Telegram"
                : "Серия · два гайда и связанные материалы"}
            </p>
            <h1 tabIndex={-1}>
              {video ? "Разработка платформы" : guideSeries}
            </h1>
            <p>
              {video
                ? "Для разработчика, которому интересна реальная работа над продуктом с агентами. Посмотрите путь Inside от лендинга до архитектуры и организации задач."
                : "Для разработчика, который впервые пробует агента в своём проекте. Настройте правила работы, проведите небольшую задачу и проверьте результат."}
            </p>
            {!video && (
              <p>
                <strong>На входе:</strong> свой проект и знакомые команды
                проверки. <strong>Результат:</strong> связанные правила проекта
                и понятный цикл от постановки до проверенного изменения.
              </p>
            )}
            <Link
              to={video ? "video" : "a"}
              primary
              changes={
                video
                  ? { episode: "1", series: "videos" }
                  : { series: "guides" }
              }
            >
              {video ? "Открыть первый выпуск" : "Начать с первого гайда"}
            </Link>
          </div>
          <img src={cover(video ? 5 : 1)} alt="" />
        </header>
        <section className="hsg-section">
          <h2>{video ? "Состав серии" : "Основной путь"}</h2>
          <p className="hsg-muted">
            {video
              ? "Восемь существующих записей в порядке выхода. Это дневник разработки, а не обязательная программа. Перенос и воспроизведение на Platform ещё не проверены."
              : "Два планируемых гайда показаны образцами A → B. Порядок определяется задачей читателя и не зависит от даты видео. Видеоразбор и заметка доступны по ссылкам и не входят в состав этой серии."}
          </p>
          <ol className="hsg-contents">
            {proofSeries[video ? "videos" : "guides"].materialSlugs.map(
              (slug, index) => {
                const material = materialSamples.find(
                  (item) => item.slug === slug,
                );
                return (
                  <li key={slug}>
                    <a href={destination(slug, video ? "videos" : "guides")}>
                      <span className="hsg-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3>{material?.title}</h3>
                        <p>
                          {material?.format} ·{" "}
                          {slug === "guide-a"
                            ? "бесплатный development-образец"
                            : "по подписке · образец"}
                        </p>
                      </div>
                      <ArrowRight aria-hidden="true" />
                    </a>
                    {!video && (slug === "guide-a" || slug === "guide-b") && (
                      <Related step={slug === "guide-a" ? "a" : "b"} />
                    )}
                  </li>
                );
              },
            )}
          </ol>
        </section>
      </>
    );
  }

  function destination(slug: string, selectedContext: SeriesContext = context) {
    if (slug === "guide-a" || slug === "guide-b")
      return href(slug === "guide-a" ? "a" : "b", { series: selectedContext });
    if (slug.startsWith("episode-"))
      return href("video", { episode: slug.slice(8), series: selectedContext });
    return href("note", { note: slug, series: selectedContext });
  }

  function ContextPicker({
    slug,
    label = "Контекст чтения",
  }: {
    readonly slug: string;
    readonly label?: string;
  }) {
    const choices = (["guides", "review", "videos"] as const).filter((key) =>
      (proofSeries[key].materialSlugs as readonly string[]).includes(slug),
    );
    if (choices.length === 0)
      return (
        <p className="hsg-muted">
          Самостоятельный материал, не входит в серии.
        </p>
      );
    const selected = context === "none" ? undefined : proofSeries[context];
    return (
      <div className="hsg-context">
        <label htmlFor="hsg-reading-context">{label}</label>
        <select
          id="hsg-reading-context"
          value={context}
          onChange={(event) => {
            navigate(href(screen, { series: event.target.value }));
          }}
        >
          <option value="none">Отдельный материал</option>
          {choices.map((key) => (
            <option key={key} value={key}>
              {proofSeries[key].name}
              {key === "review" ? " · тестовая серия" : ""}
            </option>
          ))}
        </select>
        <p>
          {selected
            ? `Материал ${String((selected.materialSlugs as readonly string[]).indexOf(slug) + 1)} из ${String(selected.materialSlugs.length)}. Порядок задан автором этой серии.`
            : "Выберите серию, чтобы увидеть порядок чтения."}
        </p>
      </div>
    );
  }

  function SequenceNavigation({ slug }: { readonly slug: string }) {
    const series = context === "none" ? undefined : proofSeries[context];
    const entries: readonly string[] = series?.materialSlugs ?? [];
    const index = entries.indexOf(slug);
    const nextSlug = index >= 0 ? entries[index + 1] : undefined;
    const nextMaterial = [...home.guides, ...home.videos, ...home.notes].find(
      (item) => item.slug === nextSlug,
    );
    return (
      <footer className="hsg-next">
        {series && index >= 0 ? (
          <>
            <p className="hsg-eyebrow">
              {series.name} · {index + 1} из {entries.length}
            </p>
            {nextMaterial ? (
              <>
                <h2>Следующий материал</h2>
                <a className="hsg-back" href={destination(nextMaterial.slug)}>
                  {nextMaterial.title}
                  <ArrowRight aria-hidden="true" size={18} />
                </a>
              </>
            ) : (
              <p>Вы дошли до конца серии.</p>
            )}
            <a
              className="hsg-back"
              href={href(
                context === "videos"
                  ? "videos"
                  : context === "review"
                    ? "review"
                    : "guides",
              )}
            >
              К составу серии
            </a>
          </>
        ) : (
          <p>
            Материал открыт самостоятельно. Следующий материал появится после
            выбора серии.
          </p>
        )}
      </footer>
    );
  }

  function Back({
    to,
    children,
  }: {
    readonly to: Screen;
    readonly children: ReactNode;
  }) {
    return (
      <a className="hsg-back" href={href(to)}>
        <ArrowLeft size={16} aria-hidden="true" />
        {children}
      </a>
    );
  }

  function Access() {
    return (
      <section className="hsg-access">
        <LockKeyhole aria-hidden="true" />
        <h2>Продолжение — для участников Inside</h2>
        <p>
          По подписке доступны полный материал и связанные ресурсы. Описание и
          состав серии открыты всем.
        </p>
        <Link to="membership" primary>
          О подписке Inside
        </Link>
        <p className="hsg-muted">
          В панели прототипа можно переключиться в состояние участника.
        </p>
      </section>
    );
  }

  function Reader() {
    const video = screen === "video";
    const key = screen === "b" ? "b" : "a";
    const guide = guides[key];
    const entry = episodes[episode - 1] ?? episodes[4];
    return (
      <div className="hsg-reader">
        <Back
          to={
            context === "none"
              ? "library"
              : context === "videos"
                ? "videos"
                : context === "review"
                  ? "review"
                  : "guides"
          }
        >
          {context === "none"
            ? "В Базу знаний"
            : context === "videos"
              ? "К видеодневнику"
              : "К составу серии"}
        </Back>
        <p className="hsg-eyebrow">
          {video
            ? `Видео · ${entry[1]} · по подписке`
            : key === "a"
              ? "Гайд · бесплатный development-образец"
              : "Гайд · образец по подписке"}
        </p>
        <h1 tabIndex={-1}>
          {video ? `Разработка платформы — ${String(episode)}` : guide.title}
        </h1>
        <p className="hsg-lead">
          {video
            ? episode === 5
              ? "Заканчиваем настройку harness и подготавливаем всё к реализации"
              : entry[0]
            : guide.summary}
        </p>
        <a className="hsg-tag" href={href("tag", { series: "none" })}>
          #agents
        </a>
        {video &&
          ContextPicker({
            slug: `episode-${String(episode)}`,
            label: "Контекст просмотра",
          })}
        {video ? (
          <>
            {member ? (
              <div className="hsg-player">
                <Play size={44} aria-hidden="true" />
                <strong>Макет видеоплеера</strong>
                <span>
                  Выпуск {episode} · {entry[1]}
                </span>
                <p>
                  Запись существует в Telegram. Файл видео ещё не подключён.
                </p>
              </div>
            ) : (
              <Access />
            )}
            <p className="hsg-muted">
              Самостоятельный видеоматериал. Текстовый гайд не требуется для его
              просмотра.
            </p>
            <Link to="videos">Состав видеодневника</Link>
            {episode === 5 && (
              <p className="hsg-muted">
                <a className="text-action" href={href("a", { series: "none" })}>
                  Связанный гайд: как организовать harness
                </a>{" "}
                · редакционная гипотеза по описанию записи.
              </p>
            )}
          </>
        ) : (
          <>
            {ContextPicker({ slug: `guide-${key}` })}
            {key === "b" && !member ? (
              <Access />
            ) : (
              <article className="hsg-body">
                <p>{guide.intro}</p>
                <nav aria-label="Содержание гайда">
                  <h2>В этом гайде</h2>
                  <ol>
                    {guide.steps.map(([title], index) => (
                      <li key={title}>
                        <a href={`#step-${String(index)}`}>{title}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
                {guide.steps.map(([title, text], index) => (
                  <section id={`step-${String(index)}`} key={title}>
                    <h2>
                      {index + 1}. {title}
                    </h2>
                    <p>{text}</p>
                  </section>
                ))}
                <section>
                  <h2>Инструкция для агента</h2>
                  <p>
                    Текст для копирования. Адаптируйте его к выбранной задаче.
                  </p>
                  <div className="hsg-code">
                    <pre>{guide.instruction}</pre>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(guide.instruction)
                          .then(
                            () => {
                              setCopied(true);
                            },
                            () => {
                              setCopied(false);
                            },
                          );
                      }}
                    >
                      {copied ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Copy aria-hidden="true" />
                      )}
                      {copied ? "Скопировано" : "Копировать инструкцию"}
                    </Button>
                    <span role="status" className="sr-only">
                      {copied ? "Инструкция скопирована" : ""}
                    </span>
                  </div>
                </section>
                <section>
                  <h2>Проверьте себя</h2>
                  <p>{guide.check}</p>
                </section>
                <section>
                  <h2>Ресурсы к образцу</h2>
                  <p>
                    <a
                      className="text-action underline"
                      href="https://github.com/sachkov-inside/workspace/blob/main/HARNESS.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Устройство harness Inside
                    </a>{" "}
                    ·{" "}
                    <a
                      className="text-action underline"
                      href="https://github.com/sachkov-inside/workspace/blob/main/WORKFLOW.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Процесс разработки
                    </a>
                  </p>
                  <a
                    className="hsg-resource"
                    download="agent-task-prompt.txt"
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(guide.instruction)}`}
                  >
                    <FileDown aria-hidden="true" />
                    <span>
                      Инструкция для агента
                      <br />
                      <small>TXT · демонстрационный файл</small>
                    </span>
                  </a>
                </section>
              </article>
            )}
            <Related step={key} />
          </>
        )}
        <SequenceNavigation
          slug={video ? `episode-${String(episode)}` : `guide-${key}`}
        />
      </div>
    );
  }

  return (
    <div ref={root} onClick={intercept} className="hsg-root">
      <ApplicationShell
        currentPath={
          screen === "home"
            ? "/"
            : screen === "profile"
              ? "/account"
              : "/library"
        }
        navigationItems={[
          { href: "/", icon: "home", label: "Главная" },
          { href: "/library", icon: "library", label: "База знаний" },
        ]}
        mobileNavigationItems={[
          { href: "/", icon: "home", label: "Главная" },
          { href: "/library", icon: "library", label: "База знаний" },
          { href: "/account", icon: "profile", label: "Профиль" },
        ]}
      >
        {!(screen === "home" && variant === "B") && <PublicProductHeader />}
        <div
          className={
            screen === "home" || screen === "library" ? "" : "hsg-reader-style"
          }
        >
          {screen === "home" ? (
            Home()
          ) : screen === "library" ? (
            <>
              <Back to="home">На главную</Back>
              <HubLibrary
                key={`${catalog.format}:${catalog.topic}:${catalog.view}`}
                home={home}
                format={catalog.format}
                topic={catalog.topic}
                view={catalog.view}
              />
            </>
          ) : screen === "note" ? (
            <>
              <Back to="home">На главную</Back>
              <HubNote
                material={home.notes.find((item) => item.slug === catalog.note)}
              />
              {ContextPicker({ slug: catalog.note })}
              <SequenceNavigation slug={catalog.note} />
            </>
          ) : screen === "videos" || screen === "guides" ? (
            Series()
          ) : screen === "video" || screen === "a" || screen === "b" ? (
            Reader()
          ) : screen === "review" ? (
            <>
              <Back to="library">В Базу знаний</Back>
              <p className="hsg-eyebrow">
                Смешанная тестовая серия · 3 образца
              </p>
              <h1 tabIndex={-1}>Проверка работы агента</h1>
              <p className="hsg-lead">
                Для разработчика со своим проектом. Разберите правила,
                посмотрите запись и прочитайте заметку о проверке небольшого
                изменения. Связь с видео пока предположена по описанию.
              </p>
              <h2 className="mt-8">Состав серии</h2>
              <p className="hsg-muted">
                Явный авторский порядок: гайд → видео → заметка. Переход не
                пропускает материалы.
              </p>
              <ol className="hsg-contents">
                {proofSeries.review.materialSlugs.map((slug, index) => {
                  const material = [
                    ...home.guides,
                    ...home.videos,
                    ...home.notes,
                  ].find((item) => item.slug === slug);
                  return (
                    <li key={slug}>
                      <a
                        href={
                          slug === "guide-a"
                            ? href("a", { series: "review" })
                            : slug === "episode-5"
                              ? href("video", {
                                  series: "review",
                                  episode: "5",
                                })
                              : href("note", { series: "review", note: slug })
                        }
                      >
                        <span className="hsg-number">0{index + 1}</span>
                        <div>
                          <h3>{material?.title}</h3>
                          <p>{material?.format} · образец</p>
                        </div>
                        <ArrowRight aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : screen === "tag" ? (
            <>
              <Back to="home">На главную</Back>
              <h1 tabIndex={-1}>Материалы по тегу #agents</h1>
              <p className="hsg-muted">
                Ограниченная подборка прототипа. Материалы можно открыть
                отдельно от серии.
              </p>
              <ol className="hsg-contents">
                {(["a", "b"] as const).map((key) => (
                  <li key={key}>
                    <a href={href(key, { series: "none" })}>
                      <BookOpen aria-hidden="true" />
                      <div>
                        <h2>{guides[key].title}</h2>
                        <p>Гайд · образец</p>
                      </div>
                      <ArrowRight aria-hidden="true" />
                    </a>
                  </li>
                ))}
                <li>
                  <a href={href("video", { episode: "5", series: "none" })}>
                    <Play aria-hidden="true" />
                    <div>
                      <h2>Разработка платформы — 5</h2>
                      <p>Видео · 26:32 · запись в Telegram</p>
                    </div>
                  </a>
                </li>
              </ol>
            </>
          ) : screen === "membership" ? (
            <>
              <Back to="home">На главную</Back>
              <h1 tabIndex={-1}>Подписка Inside</h1>
              <Subscription />
              <section className="hsg-section">
                <h2>Для самостоятельной работы и профессионального общения</h2>
                <p>
                  Материалы помогают разбирать инженерные решения и переносить
                  подходы в свой проект. Участие не включает персональное
                  менторство, проверку домашних заданий или обещание
                  трудоустройства.
                </p>
                <p className="hsg-muted">
                  Цена и оформление подписки не входят в этот прототип.
                </p>
                <Link to="a">Сначала прочитать образец</Link>
              </section>
            </>
          ) : (
            <>
              <Back to="home">На главную</Back>
              <h1 tabIndex={-1}>Профиль</h1>
              <p>
                В прототипе показан {member ? "участник Inside" : "посетитель"}.
                Переключение доступа находится в панели «Прототип #290».
              </p>
            </>
          )}
        </div>
        <details className="hsg-proof">
          <summary>
            Прототип #290 · {member ? "Участник" : "Посетитель"}
          </summary>
          <p>
            Выбранный Home — хаб с сериями и подпиской. B сохранён только как
            историческая композиция main. Заметки — иллюстративные карточки из
            main. Восемь видео известны по Telegram-источникам; гайды A/B —
            образцы, обложки — из принятого визуального набора. Реальный
            бесплатный материал, цена и публикация не выбраны.
          </p>
          <label>
            <input
              type="checkbox"
              checked={member}
              onChange={(event) => {
                navigate(
                  href(screen, { member: event.target.checked ? "1" : "0" }),
                );
              }}
            />{" "}
            Смотреть как участник
          </label>
          <p>
            Текущий экран: {screen}; серия: {context}; выпуск: {episode}.
          </p>
        </details>
        <div
          className="hsg-switcher"
          role="group"
          aria-label="Панель прототипа"
        >
          <a href={href("home", { variant: "A" })}>Серии · proof #290</a>
        </div>
      </ApplicationShell>
    </div>
  );
}
