"use client";

// Throwaway Storybook proof: compare three compact course menus using one ?variant= route.
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  List,
  LockKeyhole,
  Moon,
  Sun,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import { MaterialBodyView } from "@/entities/material";
import { renderedMaterialBodySchema } from "@/entities/material.model";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import fixture from "./fixture.json";
import styles from "./reader-programme-prototype.module.css";

const snapshot = z
  .object({
    courseTitle: z.string(),
    chapters: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        steps: z.array(z.string()),
      }),
    ),
    steps: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["material", "task"]),
        title: z.string(),
        chapter: z.number(),
        access: z.enum(["available", "locked", "unavailable"]),
      }),
    ),
    bodies: z.record(
      z.string(),
      z
        .unknown()
        .transform(
          (blocks) =>
            renderedMaterialBodySchema.parse({ schemaVersion: 1, blocks })
              .blocks,
        ),
    ),
    assetUrls: z.record(z.string(), z.string()),
  })
  .parse(fixture);
type Step = (typeof snapshot.steps)[number];
type Chapter = (typeof snapshot.chapters)[number];
type Variant = "A" | "B" | "C";
const variants = ["A", "B", "C"] as const;
const names = { A: "Дерево глав", B: "Текущая глава", C: "Ближайшие шаги" };
const initialId = "inside-content-aie-ch1-agent-basics";

function findStep(id: string): Step {
  const step = snapshot.steps.find((item) => item.id === id);
  if (step === undefined) throw new Error(`Missing prototype step: ${id}`);
  return step;
}

function findChapter(number: number): Chapter {
  const chapter = snapshot.chapters.find((item) => item.number === number);
  if (chapter === undefined) throw new Error("Missing prototype chapter");
  return chapter;
}

export function ReaderProgrammePrototype({
  initialVariant = "A",
}: {
  readonly initialVariant?: Variant;
}) {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [currentId, setCurrentId] = useState(initialId);
  const [dark, setDark] = useState(false);
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const [bookmarked, setBookmarked] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const article = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const current = findStep(currentId);
  const chapter = findChapter(current.chapter);
  const index = snapshot.steps.indexOf(current);
  const previous = snapshot.steps[index - 1];
  const next = snapshot.steps[index + 1];
  const position = chapter.steps.indexOf(current.id) + 1;

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      const rail = sidebar.current;
      const active = rail?.querySelector('[aria-current="step"]');
      if (rail === null || active === undefined || active === null) return;
      const frame = rail.getBoundingClientRect();
      const row = active.getBoundingClientRect();
      if (row.bottom > frame.bottom - 2)
        rail.scrollTop += row.bottom - frame.bottom + 2;
      else if (row.top < frame.top + 2)
        rail.scrollTop += row.top - frame.top - 2;
    });
    return () => {
      cancelled = true;
    };
  }, [current.id, variant]);

  // Scope repeated quiz landmarks to this proof without changing the shared renderer.
  useEffect(() => {
    article.current
      ?.querySelectorAll("[data-material-quiz]")
      .forEach((element, question) => {
        element.setAttribute(
          "aria-label",
          "Проверьте понимание. Вопрос " + String(question + 1),
        );
      });
  }, [current.id]);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setVariant(
        z.enum(variants).catch(initialVariant).parse(params.get("variant")),
      );
      const id = params.get("step");
      if (id !== null && snapshot.steps.some((step) => step.id === id))
        setCurrentId(id);
      setDark(params.get("theme") === "dark");
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
    };
  }, [initialVariant]);

  function updateUrl(nextVariant: Variant, stepId: string, isDark: boolean) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", nextVariant);
    url.searchParams.set("step", stepId);
    url.searchParams.set("theme", isDark ? "dark" : "light");
    window.history.replaceState(null, "", url);
  }
  function go(step: Step) {
    setCurrentId(step.id);
    setBookmarked(false);
    updateUrl(variant, step.id, dark);
    dialog.current?.close();
    document.querySelector("[data-application-content]")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => {
      article.current?.focus({ preventScroll: true });
    });
  }
  function changeVariant(value: Variant) {
    setVariant(value);
    updateUrl(value, current.id, dark);
  }
  function cycle(direction: number) {
    changeVariant(
      variants[
        (variants.indexOf(variant) + direction + variants.length) %
          variants.length
      ] ?? "A",
    );
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, button, a, [contenteditable], dialog[open]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowLeft" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  function href(step: Step) {
    const params = new URLSearchParams(window.location.search);
    params.set("variant", variant);
    params.set("step", step.id);
    params.set("theme", dark ? "dark" : "light");
    return `?${params.toString()}`;
  }
  function stepLink(step: Step, compact = false): ReactNode {
    const active = step.id === current.id;
    return (
      <a
        key={step.id}
        href={href(step)}
        aria-current={active ? "step" : undefined}
        onClick={(event) => {
          event.preventDefault();
          go(step);
        }}
        className={cn(styles["step"], active && styles["active"])}
      >
        <span className={styles["stepMark"]} aria-hidden="true">
          {read.has(step.id) ? (
            <Check size={12} />
          ) : step.kind === "task" ? (
            <span className={styles["taskDot"]} />
          ) : (
            <span className={styles["lessonDot"]} />
          )}
        </span>
        <span>
          {step.kind === "task" ? (
            <span className={styles["taskLabel"]}>Задание · </span>
          ) : null}
          {step.title}
        </span>
        {step.access === "locked" && !compact ? (
          <LockKeyhole
            size={11}
            className={styles["lock"]}
            aria-label="Нужен доступ"
          />
        ) : null}
      </a>
    );
  }
  function chapterList(item: Chapter) {
    return item.steps.map((id) => stepLink(findStep(id)));
  }
  function tree() {
    return snapshot.chapters.map((item) => (
      <details
        key={String(current.chapter) + "-" + String(item.number)}
        open={item.number === current.chapter}
        className={styles["chapter"]}
      >
        <summary>
          <ChevronRight size={13} aria-hidden="true" />
          <span>
            {item.number}. {item.title}
          </span>
        </summary>
        {item.steps.length === 0 ? (
          <p className={styles["soon"]}>Глава готовится</p>
        ) : (
          <div className={styles["treeSteps"]}>{chapterList(item)}</div>
        )}
      </details>
    ));
  }
  const menuProps = {
    current,
    chapter,
    position,
    stepLink,
    chapterList,
    tree,
    openProgramme: () => {
      dialog.current?.showModal();
    },
  };
  const side =
    variant === "A" ? (
      <VariantA {...menuProps} />
    ) : variant === "B" ? (
      <VariantB
        {...menuProps}
        onChapter={(number) => {
          const id = snapshot.chapters.find((item) => item.number === number)
            ?.steps[0];
          const step = snapshot.steps.find((item) => item.id === id);
          if (step !== undefined) go(step);
        }}
      />
    ) : (
      <VariantC {...menuProps} />
    );
  const body = snapshot.bodies[current.id];

  function followBodyLink(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a");
    if (anchor === null) return;
    const pathname = new URL(anchor.href).pathname;
    const target = snapshot.steps.find((step) =>
      pathname.endsWith(`/${step.id}`),
    );
    if (target !== undefined) {
      event.preventDefault();
      go(target);
    }
  }
  const content = (
    <article
      ref={article}
      tabIndex={-1}
      className={styles["article"]}
      onClickCapture={followBodyLink}
    >
      <div className={styles["place"]}>
        <span>Глава {current.chapter}</span>
        <span aria-hidden="true">·</span>
        <span>
          Шаг {position} из {chapter.steps.length}
        </span>
      </div>
      <h1>{current.title}</h1>
      <div className={styles["meta"]}>
        <span>{current.kind === "task" ? "Задание" : "Гайд"}</span>
        <span aria-hidden="true">·</span>
        <span>AI Engineering</span>
        <div className={styles["actions"]}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={bookmarked ? "Убрать закладку" : "Добавить закладку"}
            onClick={() => {
              setBookmarked(!bookmarked);
            }}
          >
            <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
          </Button>
          {current.kind === "material" ? (
            <Button
              variant="ghost"
              onClick={() => {
                setRead((old) => {
                  const values = new Set(old);
                  if (values.has(current.id)) values.delete(current.id);
                  else values.add(current.id);
                  return values;
                });
              }}
            >
              {read.has(current.id) ? <Check size={15} /> : null}Изучено
            </Button>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          styles["body"],
          "[&_h2:not([data-quiz-heading])]:text-lg [&_h3:not([data-comparison-heading])]:text-base [&_h4]:text-[0.9375rem] sm:[&_h2:not([data-quiz-heading])]:text-xl sm:[&_h3:not([data-comparison-heading])]:text-lg sm:[&_h4]:text-base md:[&_h2:not([data-quiz-heading])]:text-2xl md:[&_h3:not([data-comparison-heading])]:text-xl md:[&_h4]:text-lg",
        )}
      >
        {body === undefined ? (
          <section className={styles["access"]}>
            <LockKeyhole size={22} aria-hidden="true" />
            <h2>Нужен доступ к курсу</h2>
            <p>
              Этот шаг остаётся в программе. Здесь можно посмотреть его место и
              перейти к соседним шагам.
            </p>
          </section>
        ) : (
          <MaterialBodyView
            key={current.id}
            blocks={body}
            path={[]}
            rendering={{
              headingId: (path) => `prototype-section-${path.join("-")}`,
              image: (block) => (
                <figure className={styles["figure"]}>
                  {/* oxlint-disable-next-line next/no-img-element -- Snapshot assets are served locally by Storybook. */}
                  <img
                    src={snapshot.assetUrls[block.assetId]}
                    alt={block.alt}
                    width={block.width}
                    height={block.height}
                    loading="lazy"
                  />
                </figure>
              ),
              file: (block) => (
                <a href={snapshot.assetUrls[block.assetId]}>{block.label}</a>
              ),
            }}
          />
        )}
      </div>
      <nav
        aria-label="Соседние шаги программы"
        className={styles["neighbours"]}
      >
        {previous === undefined ? (
          <span />
        ) : (
          <a
            href={href(previous)}
            onClick={(event) => {
              event.preventDefault();
              go(previous);
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>
              <small>
                {previous.kind === "task"
                  ? "Предыдущее задание"
                  : "Предыдущий урок"}
              </small>
              {previous.title}
            </span>
          </a>
        )}
        {next === undefined ? (
          <span>Программа завершена</span>
        ) : (
          <a
            href={href(next)}
            className={styles["next"]}
            onClick={(event) => {
              event.preventDefault();
              go(next);
            }}
          >
            <span>
              <small>
                {next.kind === "task" ? "Следующее задание" : "Следующий урок"}
              </small>
              {next.title}
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        )}
      </nav>
      {current.kind === "task" ? (
        <p className={styles["prototypeNote"]}>
          Прототип страницы задания. Отправка задания здесь не выполняется.
        </p>
      ) : null}
    </article>
  );

  return (
    <div
      className={cn(
        styles["prototype"],
        styles[`variant${variant}`],
        dark && "dark",
      )}
    >
      <div className={styles["mobilePlace"]}>
        <Button
          variant="ghost"
          onClick={() => {
            dialog.current?.showModal();
          }}
        >
          <List size={16} />
          Программа
        </Button>
        <span>
          Глава {current.chapter} · {position}/{chapter.steps.length}
        </span>
      </div>
      <div className={styles["layout"]}>
        <aside
          ref={sidebar}
          className={styles["sidebar"]}
          aria-label="Программа курса"
        >
          {side}
        </aside>
        {content}
      </div>
      <dialog
        ref={dialog}
        className={styles["dialog"]}
        aria-labelledby="prototype-programme-title"
      >
        <header>
          <h2 id="prototype-programme-title">Программа курса</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Закрыть программу"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            <X size={18} />
          </Button>
        </header>
        <nav aria-label="Полная программа">{tree()}</nav>
      </dialog>
      <div
        className={styles["switcher"]}
        role="region"
        aria-label="Сравнение прототипов"
      >
        <button
          type="button"
          onClick={() => {
            cycle(-1);
          }}
          aria-label="Предыдущий вариант"
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          Прототип <b>{variant}</b>
          <span className={styles["variantName"]}> · {names[variant]}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            cycle(1);
          }}
          aria-label="Следующий вариант"
        >
          <ChevronRight size={17} />
        </button>
        <span className={styles["switcherDivider"]} />
        <button
          type="button"
          aria-label={dark ? "Светлая тема" : "Тёмная тема"}
          onClick={() => {
            setDark(!dark);
            updateUrl(variant, current.id, !dark);
          }}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </div>
  );
}

interface MenuProps {
  readonly current: Step;
  readonly chapter: Chapter;
  readonly position: number;
  readonly stepLink: (step: Step, compact?: boolean) => ReactNode;
  readonly chapterList: (chapter: Chapter) => ReactNode;
  readonly tree: () => ReactNode;
  readonly openProgramme: () => void;
}
function VariantA({ tree }: MenuProps) {
  return (
    <nav className={styles["tree"]} aria-label="Главы и шаги">
      <p className={styles["menuTitle"]}>Программа курса</p>
      {tree()}
    </nav>
  );
}
function VariantB({
  chapter,
  chapterList,
  openProgramme,
  onChapter,
}: MenuProps & { readonly onChapter: (number: number) => void }) {
  return (
    <nav className={styles["chapterOnly"]} aria-label="Текущая глава">
      <button
        type="button"
        className={styles["backProgramme"]}
        onClick={openProgramme}
      >
        <List size={14} />
        Вся программа
      </button>
      <label className={styles["chapterPicker"]}>
        <span>Глава</span>
        <select
          aria-label="Выбрать главу"
          value={chapter.number}
          onChange={(event) => {
            onChapter(Number(event.target.value));
          }}
        >
          {snapshot.chapters
            .filter((item) => item.steps.length > 0)
            .map((item) => (
              <option key={item.number} value={item.number}>
                {item.number}. {item.title}
              </option>
            ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </label>
      <div className={styles["chapterSteps"]}>{chapterList(chapter)}</div>
    </nav>
  );
}
function VariantC({
  current,
  chapter,
  position,
  stepLink,
  openProgramme,
}: MenuProps) {
  const index = chapter.steps.indexOf(current.id);
  const start = Math.min(
    Math.max(0, index - 2),
    Math.max(0, chapter.steps.length - 5),
  );
  const nearby = chapter.steps.slice(start, start + 5);
  return (
    <nav className={styles["nearby"]} aria-label="Ближайшие шаги">
      <button
        type="button"
        className={styles["backProgramme"]}
        onClick={openProgramme}
      >
        <List size={14} />
        Программа курса
      </button>
      <p className={styles["chapterCaption"]}>Глава {chapter.number}</p>
      <p className={styles["chapterTitle"]}>{chapter.title}</p>
      <p className={styles["position"]}>
        Шаг {position} из {chapter.steps.length}
      </p>
      <div className={styles["nearbySteps"]}>
        {nearby.map((id) => stepLink(findStep(id), true))}
      </div>
      <button
        type="button"
        className={styles["allSteps"]}
        onClick={openProgramme}
      >
        Все шаги курса
        <ArrowRight size={13} />
      </button>
    </nav>
  );
}
