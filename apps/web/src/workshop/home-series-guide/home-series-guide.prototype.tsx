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
import { Button } from "@/shared/ui/button";
import {
  ApplicationShell,
  PublicProductHeader,
} from "@/widgets/application-shell";
import { episodes, guides } from "./content.fixture";
import "./home-series-guide.prototype.css";

/** THROWAWAY #290: two Home compositions, one shared series/reader journey; no production data. */
type Screen =
  | "home"
  | "videos"
  | "guides"
  | "video"
  | "a"
  | "b"
  | "tag"
  | "membership"
  | "profile";
type Variant = "A" | "B";
type SeriesContext = "guides" | "review" | "none";
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
  const [context, setContext] = useState<SeriesContext>("guides");
  const [episode, setEpisode] = useState(5);
  const [copied, setCopied] = useState(false);
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
      setMember(
        query.has("member") ? query.get("member") === "1" : initialMember,
      );
      const source = query.get("series");
      setContext(source === "none" || source === "review" ? source : "guides");
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
  }, [screen, variant]);

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

  useEffect(() => {
    const cycle = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, select, button, a, [contenteditable]",
        )
      )
        return;
      event.preventDefault();
      navigate(href("home", { variant: variant === "A" ? "B" : "A" }));
    };
    window.addEventListener("keydown", cycle);
    return () => {
      window.removeEventListener("keydown", cycle);
    };
  });

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

  function SeriesCard({
    video,
    compact = false,
  }: {
    readonly video: boolean;
    readonly compact?: boolean;
  }) {
    return (
      <article className={`hsg-series ${compact ? "hsg-series-compact" : ""}`}>
        <a
          className="hsg-art"
          href={href(video ? "videos" : "guides")}
          aria-label={
            video
              ? "Открыть видеоплейлист Разработка платформы"
              : `Открыть серию ${guideSeries}`
          }
        >
          <img src={cover(video ? 5 : 1)} alt="" />
          <span className="hsg-art-label">
            {video ? (
              <Play aria-hidden="true" />
            ) : (
              <BookOpen aria-hidden="true" />
            )}
            {video ? "Видеоплейлист" : "Серия гайдов"}
          </span>
        </a>
        <div className="hsg-series-copy">
          <p className="hsg-eyebrow">
            {video ? "8 видео · записи в Telegram" : "Планируется · 2 образца"}
          </p>
          <h2>
            <a href={href(video ? "videos" : "guides")}>
              {video ? "Разработка платформы" : guideSeries}
            </a>
          </h2>
          <p>
            {video
              ? "Посмотрите, как создаётся Inside: от лендинга и правил работы агента до технических решений, дизайна и организации задач."
              : "Разберите процесс Inside и организуйте работу агента в своём проекте: от правил и постановки задачи до проверки результата."}
          </p>
          <Link to={video ? "videos" : "guides"}>
            {video ? "Посмотреть состав" : "Открыть образцы гайдов"}
          </Link>
        </div>
      </article>
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

  function Sample() {
    return (
      <section className="hsg-sample">
        <div>
          <p className="hsg-eyebrow">
            Начните с примера · макет бесплатного чтения
          </p>
          <h2>Как организовать работу агента в проекте</h2>
          <p>
            Четыре шага, инструкция для копирования и проверка результата.
            Откройте образец и оцените подход.
          </p>
        </div>
        <Link to="a" primary changes={{ series: "guides" }}>
          Читать образец
        </Link>
      </section>
    );
  }

  function Home() {
    if (variant === "B")
      return (
        <>
          <header className="hsg-intro">
            <p className="hsg-eyebrow">
              Inside · инженерная практика Кирилла Сачкова
            </p>
            <h1 tabIndex={-1}>
              Как строятся продукты.
              <br />И как работать над своим.
            </h1>
            <p>
              Для разработчиков, которые уже пишут код и хотят применять
              современные production- и AI-first практики. Выберите серию и
              начните с интересного вам материала.
            </p>
          </header>
          <div className="hsg-series-rows">
            <SeriesCard video />
            <SeriesCard video={false} />
          </div>
          <Sample />
          <Subscription />
        </>
      );
    return (
      <>
        <header className="hsg-hero">
          <div>
            <p className="hsg-eyebrow">
              Inside · инженерная практика Кирилла Сачкова
            </p>
            <h1 tabIndex={-1}>
              Загляните в процесс.
              <br />
              <span>Примените в своей работе.</span>
            </h1>
            <p>
              Для разработчиков, которые уже пишут код. Реальная работа над
              продуктами, production-решения и AI-first практики — с контекстом,
              кодом и разбором выбора.
            </p>
            <div className="hsg-actions">
              <Link to="videos" primary>
                Начать с разработки Inside
              </Link>
              <Link to="a">Читать образец гайда</Link>
            </div>
          </div>
          <div className="hsg-hero-art">
            <img src={cover(5)} alt="" />
            <span>От идеи продукта до инженерных решений</span>
          </div>
        </header>
        <section className="hsg-section" aria-labelledby="series-title">
          <p className="hsg-eyebrow">Два способа разобраться</p>
          <h2 id="series-title">Наблюдайте за работой. Повторяйте подходы.</h2>
          <div className="hsg-series-grid">
            <SeriesCard video compact />
            <SeriesCard video={false} compact />
          </div>
        </section>
        <Subscription />
        <Sample />
      </>
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
                ? "Видеоплейлист · записи в Telegram"
                : "Серия гайдов · планируется"}
            </p>
            <h1 tabIndex={-1}>
              {video ? "Разработка платформы" : guideSeries}
            </h1>
            <p>
              {video
                ? "Для разработчика, которому интересна реальная работа над продуктом с агентами. Посмотрите путь Inside от лендинга до архитектуры и организации задач."
                : "Для разработчика, который впервые пробует агента и хочет связать правила, skills, планирование, выполнение и review в один процесс."}
            </p>
            <Link
              to={video ? "video" : "a"}
              primary
              changes={video ? { episode: "1" } : { series: "guides" }}
            >
              {video ? "Открыть первый выпуск" : "Начать с первого гайда"}
            </Link>
          </div>
          <img src={cover(video ? 5 : 1)} alt="" />
        </header>
        <section className="hsg-section">
          <h2>Состав серии</h2>
          <p className="hsg-muted">
            {video
              ? "Восемь существующих записей. Перенос на Platform и воспроизведение ещё не проверены."
              : "Сейчас доступны два образца для проверки дизайна. Остальные гайды ещё не определены."}
          </p>
          <ol className="hsg-contents">
            {video
              ? episodes.map(([title, duration], index) => (
                  <li key={title}>
                    <a href={href("video", { episode: String(index + 1) })}>
                      <span className="hsg-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3>{title}</h3>
                        <p>Видео · {duration} · по подписке</p>
                      </div>
                      <Play aria-hidden="true" />
                    </a>
                  </li>
                ))
              : (["a", "b"] as const).map((key, index) => (
                  <li key={key}>
                    <a href={href(key, { series: "guides" })}>
                      <span className="hsg-number">0{index + 1}</span>
                      <div>
                        <h3>{guides[key].title}</h3>
                        <p>
                          {key === "a"
                            ? "Гайд · бесплатный development-образец"
                            : "Гайд · образец доступа по подписке"}
                        </p>
                      </div>
                      <ArrowRight aria-hidden="true" />
                    </a>
                  </li>
                ))}
          </ol>
        </section>
      </>
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
        <Back to={video ? "videos" : context === "none" ? "tag" : "guides"}>
          {video
            ? "К видеоплейлисту"
            : context === "none"
              ? "К результатам по тегу"
              : "К серии гайдов"}
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
        <p className="hsg-lead">{video ? entry[0] : guide.summary}</p>
        <a className="hsg-tag" href={href("tag", { series: "none" })}>
          #agents
        </a>
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
            <Link to="videos">Все выпуски плейлиста</Link>
          </>
        ) : (
          <>
            <div className="hsg-context">
              <label htmlFor="hsg-series">Контекст чтения</label>
              <select
                id="hsg-series"
                value={context}
                onChange={(event) => {
                  navigate(href(screen, { series: event.target.value }));
                }}
              >
                <option value="none">Отдельный материал</option>
                <option value="guides">{guideSeries}</option>
                <option value="review">
                  Проверка работы агента · тестовая серия
                </option>
              </select>
              <p>
                {context === "review"
                  ? "Один материал в другой тестовой серии. Следующий выпуск здесь не задан."
                  : context === "guides"
                    ? `Материал ${key === "a" ? "1" : "2"} из 2 образцов. Следующий шаг определяется этой серией.`
                    : "Выберите серию, чтобы увидеть порядок чтения."}
              </p>
            </div>
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
            <footer className="hsg-next">
              {context === "guides" ? (
                <>
                  <p className="hsg-eyebrow">
                    {key === "a"
                      ? "Дальше в этой серии"
                      : "Вы дошли до последнего образца"}
                  </p>
                  {key === "a" ? (
                    <Link to="b" primary>
                      {guides.b.title}
                    </Link>
                  ) : (
                    <>
                      <p>
                        Дополнительные гайды планируются. Нового выпуска пока
                        нет.
                      </p>
                      <Link to="a">Вернуться к первому гайду</Link>
                    </>
                  )}
                </>
              ) : (
                <p>
                  Следующий материал не выбран. Выберите контекст серии выше.
                </p>
              )}
              <a className="hsg-back" href={href("guides")}>
                К составу серии
              </a>
            </footer>
          </>
        )}
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
        <PublicProductHeader />
        <details className="hsg-proof">
          <summary>
            Прототип #290 · {member ? "Участник" : "Посетитель"}
          </summary>
          <p>
            Варианты на одном содержании. Восемь видео известны по
            Telegram-источникам; гайды A/B — образцы, обложки — из принятого
            визуального набора. Реальный бесплатный материал, цена и публикация
            не выбраны.
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
        {screen === "home" ? (
          Home()
        ) : screen === "videos" || screen === "guides" ? (
          Series()
        ) : screen === "video" || screen === "a" || screen === "b" ? (
          Reader()
        ) : screen === "tag" ? (
          <>
            <Back to="home">На главную</Back>
            <h1 tabIndex={-1}>Материалы по тегу #agents</h1>
            <p className="hsg-muted">
              Ограниченная подборка прототипа. Материалы можно открыть отдельно
              от серии.
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
        <div className="hsg-switcher" aria-label="Сравнение вариантов главной">
          <button
            aria-label="Предыдущий вариант"
            onClick={() => {
              navigate(href("home", { variant: variant === "A" ? "B" : "A" }));
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <a href={href("home")}>
            {variant} · {variant === "A" ? "Сначала ценность" : "Сначала серии"}
          </a>
          <button
            aria-label="Следующий вариант"
            onClick={() => {
              navigate(href("home", { variant: variant === "A" ? "B" : "A" }));
            }}
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </ApplicationShell>
    </div>
  );
}
