"use client";

// THESIS: Guide and task read as one quiet document, with truthful controls.
// OWN-WORLD: Existing Manrope, semantic palette, application shell, 688px reading column.
// STORY: Read the guide, prepare the project, review the report, then continue the programme.
// FIRST VIEWPORT: Compact shared pager, title, orientation, original introduction and lookup diagram.
// FORM: Three owner-pinned editorial structures; URL-switchable Storybook-only proof for #1414.

import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  SlidersHorizontal,
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
import { MaterialBodyView, materialSourceAnchors } from "@/entities/material";
import type { RenderedBlock } from "@/entities/material.model";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { HarnessDiagram } from "./harness-diagram";
import {
  exampleSubmissions,
  TaskSubmission,
  type DemoSubmission,
  type Scenario,
} from "./task-submission";
import {
  findStep,
  guideId,
  snapshot,
  task,
  taskId,
  variants,
  variantNames,
  type Step,
  type Variant,
} from "./snapshot";
import styles from "./unified-reading-prototype.module.css";

const scenarioSchema = z.enum([
  "ready",
  "history",
  "unavailable",
  "version",
  "closed",
  "expired",
]);
const storyId = "prototypes-unified-guide-task-reading--playground";

export function UnifiedReadingPrototype() {
  const [variant, setVariant] = useState<Variant>("A");
  const [currentId, setCurrentId] = useState(guideId);
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set());
  const [submissions, setSubmissions] = useState<readonly DemoSubmission[]>([]);
  const article = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = findStep(currentId);
  const chapter = snapshot.chapters.find(
    (item) => item.number === current.chapter,
  );
  const index = snapshot.steps.indexOf(current);
  const previous = snapshot.steps[index - 1];
  const next = snapshot.steps[index + 1];
  const body = snapshot.bodies[currentId];
  const sourceAnchors = materialSourceAnchors(body ?? []);
  const headings = (body ?? []).flatMap((block, at) =>
    block.kind === "heading" && block.level === 2
      ? [
          {
            title: block.content.map((text) => text.text).join(""),
            id: sourceAnchors.get(String(at)) ?? "pilot-section-" + String(at),
          },
        ]
      : [],
  );
  const displayed =
    scenario === "history" && submissions.length === 0
      ? exampleSubmissions
      : submissions;
  const isPilotTask = currentId === taskId;

  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(window.location.search);
      setVariant(z.enum(variants).catch("A").parse(params.get("variant")));
      const step = params.get("step");
      setCurrentId(
        snapshot.steps.some((item) => item.id === step) && step !== null
          ? step
          : guideId,
      );
      setScenario(scenarioSchema.catch("ready").parse(params.get("scenario")));
    }
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
    };
  }, []);
  useEffect(() => {
    const active = rail.current?.querySelector('[aria-current="step"]');
    if (active instanceof HTMLElement && rail.current !== null) {
      const r = rail.current.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      if (a.bottom > r.bottom) rail.current.scrollTop += a.bottom - r.bottom;
      if (a.top < r.top) rail.current.scrollTop += a.top - r.top;
    }
    article.current
      ?.querySelectorAll("[data-material-quiz]")
      .forEach((node, at) => {
        node.setAttribute(
          "aria-label",
          "Проверьте понимание. Вопрос " + String(at + 1),
        );
      });
  }, [currentId, variant]);

  function href(
    step: Step,
    selectedVariant = variant,
    selectedScenario = scenario,
  ) {
    return (
      "?" +
      new URLSearchParams({
        id: storyId,
        viewMode: "story",
        variant: selectedVariant,
        step: step.id,
        scenario: selectedScenario,
      }).toString()
    );
  }
  function updateUrl(
    step: Step,
    selectedVariant = variant,
    selectedScenario = scenario,
    push = false,
  ) {
    if (push)
      window.history.pushState(
        null,
        "",
        href(step, selectedVariant, selectedScenario),
      );
    else
      window.history.replaceState(
        null,
        "",
        href(step, selectedVariant, selectedScenario),
      );
  }
  function go(step: Step, hash = "") {
    setCurrentId(step.id);
    updateUrl(step, variant, scenario, true);
    dialog.current?.close();
    document.querySelector("[data-application-content]")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => {
      article.current?.focus({ preventScroll: true });
      if (hash !== "")
        document
          .getElementById(decodeURIComponent(hash.slice(1)))
          ?.scrollIntoView();
    });
  }
  function changeVariant(direction: number) {
    const selected =
      variants[
        (variants.indexOf(variant) + direction + variants.length) %
          variants.length
      ] ?? "A";
    setVariant(selected);
    updateUrl(current, selected);
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, button, a, summary, [contenteditable], dialog[open]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        changeVariant(event.key === "ArrowLeft" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });
  function changeScenario(value: Scenario) {
    setScenario(value);
    updateUrl(current, variant, value);
  }
  function toggle(
    set: (value: (old: ReadonlySet<string>) => ReadonlySet<string>) => void,
  ) {
    set((old) => {
      const updated = new Set(old);
      if (updated.has(currentId)) updated.delete(currentId);
      else updated.add(currentId);
      return updated;
    });
  }
  function followBodyLink(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a");
    if (anchor === null) return;
    const url = new URL(anchor.href);
    const target = snapshot.steps.find((step) =>
      url.pathname.endsWith("/" + step.id),
    );
    if (target !== undefined) {
      event.preventDefault();
      go(target, url.hash);
    }
    // Other source references have no body in the captured fixture. Keep them read-only.
  }
  function stepLink(step: Step): ReactNode {
    return (
      <a
        key={step.id}
        href={href(step)}
        className={styles["step"]}
        aria-current={currentId === step.id ? "step" : undefined}
        onClick={(event) => {
          event.preventDefault();
          go(step);
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            styles["stepMark"],
            step.kind === "task" && styles["taskMark"],
          )}
        />
        <span>
          {step.kind === "task" ? "Задание · " : ""}
          {step.title}
        </span>
        {step.access === "locked" ? <small>Закрыто</small> : null}
      </a>
    );
  }
  function programme() {
    return snapshot.chapters.map((item) => (
      <details
        key={String(current.chapter) + "-" + String(item.number)}
        open={item.number === current.chapter}
        className={styles["chapter"]}
      >
        <summary>
          {item.number}. {item.title}
        </summary>
        {item.steps.length === 0 ? (
          <p>Глава готовится</p>
        ) : (
          item.steps.map((id) => stepLink(findStep(id)))
        )}
      </details>
    ));
  }
  function pager(position: "upper" | "lower") {
    return (
      <nav
        aria-label={
          position === "upper"
            ? "Навигация по программе"
            : "Навигация после чтения"
        }
        className={styles["pager"]}
        data-pager={position}
      >
        {previous === undefined ? (
          <span className={styles["disabledArrow"]} />
        ) : (
          <a
            href={href(previous)}
            aria-label={"Предыдущий шаг: " + previous.title}
            onClick={(e) => {
              e.preventDefault();
              go(previous);
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </a>
        )}
        <Button
          type="button"
          variant="ghost"
          aria-label="Программа"
          onClick={() => {
            dialog.current?.showModal();
          }}
        >
          <List size={16} aria-hidden="true" />
          <span>Программа</span>
        </Button>
        <div className={styles["readingActions"]}>
          {current.kind === "material" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                aria-label={
                  bookmarks.has(currentId)
                    ? "Убрать закладку"
                    : "Добавить закладку"
                }
                onClick={() => {
                  toggle(setBookmarks);
                }}
              >
                <Bookmark
                  size={16}
                  aria-hidden="true"
                  fill={bookmarks.has(currentId) ? "currentColor" : "none"}
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={read.has(currentId)}
                onClick={() => {
                  toggle(setRead);
                }}
              >
                <Check size={16} aria-hidden="true" />
                <span>{read.has(currentId) ? "Изучено" : "Не изучено"}</span>
              </Button>
            </>
          ) : isPilotTask ? (
            <a
              href="#pilot-submit"
              onClick={() => {
                document.getElementById("pilot-submit")?.scrollIntoView();
              }}
            >
              Сдать
            </a>
          ) : (
            <span>Задание</span>
          )}
        </div>
        {next === undefined ? (
          <span className={styles["disabledArrow"]} />
        ) : (
          <a
            href={href(next)}
            aria-label={"Следующий шаг: " + next.title}
            onClick={(e) => {
              e.preventDefault();
              go(next);
            }}
          >
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        )}
      </nav>
    );
  }
  function contents() {
    return (
      <nav aria-label="В этой странице" className={styles["contents"]}>
        <p>В этой странице</p>
        {headings.map((item) => (
          <a key={item.id} href={"#" + item.id}>
            {item.title}
          </a>
        ))}
        {isPilotTask ? <a href="#pilot-mine">Мои сдачи</a> : null}
      </nav>
    );
  }
  const rendering = {
    headingId: (path: readonly number[]) => "pilot-section-" + path.join("-"),
    image: (block: Extract<RenderedBlock, { kind: "image" }>) =>
      currentId === guideId ? (
        <HarnessDiagram focus="lookup" />
      ) : (
        <figure className={styles["image"]}>
          {/* oxlint-disable-next-line next/no-img-element -- Read-only programme snapshot assets served by Storybook. */}
          <img
            src={snapshot.assetUrls[block.assetId]}
            alt={block.alt}
            width={block.width}
            height={block.height}
            loading="lazy"
          />
        </figure>
      ),
    file: (block: Extract<RenderedBlock, { kind: "file" }>) => (
      <a href={snapshot.assetUrls[block.assetId]}>{block.label}</a>
    ),
  };
  const submitAt = isPilotTask
    ? (body ?? []).findIndex(
        (block) =>
          block.kind === "heading" &&
          block.content.some((text) => text.text === "Материалы к заданию"),
      )
    : -1;
  function renderBody(
    blocks: readonly RenderedBlock[],
    start: number,
    hint?: ReactNode,
    hintAt?: number,
  ) {
    return (
      <MaterialBodyView
        blocks={blocks}
        path={[]}
        rendering={{
          ...rendering,
          headingId: (path) =>
            "pilot-section-" + String((path[0] ?? 0) + start),
        }}
        hint={hint}
        hintAt={hintAt}
      />
    );
  }
  function guideBody(blocks: readonly RenderedBlock[]) {
    // Original block offsets preserve legacy aliases; source heading anchors stay untouched.
    return (
      <>
        {renderBody(blocks.slice(0, 12), 0, <HarnessDiagram />, 1)}
        <HarnessDiagram focus="brief" />
        {renderBody(blocks.slice(12, 23), 12)}
        <HarnessDiagram focus="skills" />
        {renderBody(blocks.slice(23), 23)}
      </>
    );
  }
  const content = (
    <article
      ref={article}
      tabIndex={-1}
      className={styles["article"]}
      onClickCapture={followBodyLink}
      data-step={currentId}
    >
      {pager("upper")}
      <header className={styles["header"]}>
        <h1>{current.title}</h1>
        <p className={styles["orientation"]}>
          {current.kind === "task" ? "Задание" : "Гайд"} · Глава{" "}
          {current.chapter} · Шаг {(chapter?.steps.indexOf(currentId) ?? 0) + 1}{" "}
          из {chapter?.steps.length}
        </p>
        {isPilotTask ? (
          <div className={styles["taskStatus"]}>
            <span>{displayed.length === 0 ? "Ещё не сдано" : "Сдано"}</span>
            <small>Требования: версия {task.version}</small>
            <a href="#pilot-submit">Сдать</a>
            <a href="#pilot-mine">Мои сдачи</a>
          </div>
        ) : null}
      </header>
      {variant === "C" ? (
        <details className={styles["inlineContents"]}>
          <summary>В этой странице</summary>
          {contents()}
        </details>
      ) : null}
      <div className={styles["body"]}>
        {body === undefined ? (
          <>
            <h2>Нужен доступ к курсу</h2>
            <p>
              Этот шаг остаётся в программе. Здесь можно перейти к соседним
              шагам.
            </p>
          </>
        ) : (
          <>
            {currentId === guideId
              ? guideBody(body)
              : renderBody(
                  submitAt === -1 ? body : body.slice(0, submitAt),
                  0,
                  isPilotTask ? <HarnessDiagram taskOverview /> : undefined,
                  1,
                )}
            {isPilotTask ? (
              <TaskSubmission
                scenario={scenario}
                submissions={displayed}
                onSubmit={(item) => {
                  setSubmissions([item, ...displayed]);
                }}
                onRecover={() => {
                  changeScenario("ready");
                }}
              />
            ) : null}
            {submitAt === -1
              ? null
              : renderBody(body.slice(submitAt), submitAt)}
          </>
        )}
      </div>
      {pager("lower")}
    </article>
  );
  return (
    <div
      className={cn(styles["prototype"], styles["variant" + variant])}
      lang="ru"
    >
      <div className={styles["layout"]}>
        {variant === "A" ? (
          <aside
            className={styles["rail"]}
            ref={rail}
            aria-label="Программа курса"
          >
            {programme()}
          </aside>
        ) : null}
        {content}
        {variant === "B" ? (
          <aside className={styles["rail"]}>{contents()}</aside>
        ) : null}
      </div>
      <dialog
        ref={dialog}
        className={styles["dialog"]}
        aria-labelledby="pilot-programme-heading"
      >
        <header>
          <h2 id="pilot-programme-heading">Программа курса</h2>
          <Button
            type="button"
            variant="ghost"
            aria-label="Закрыть программу"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            <X aria-hidden="true" size={18} />
          </Button>
        </header>
        <nav aria-label="Все главы и шаги">{programme()}</nav>
      </dialog>
      <div
        className={styles["switcher"]}
        role="region"
        aria-label="Управление прототипом"
      >
        <button
          type="button"
          aria-label="Предыдущий вариант"
          onClick={() => {
            changeVariant(-1);
          }}
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <span>
          Прототип {variant}{" "}
          <span className={styles["variantName"]}>
            · {variantNames[variant]}
          </span>
        </span>
        <button
          type="button"
          aria-label="Следующий вариант"
          onClick={() => {
            changeVariant(1);
          }}
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
        <details className={styles["prototypeSettings"]}>
          <summary aria-label="Настройки прототипа">
            <SlidersHorizontal aria-hidden="true" size={16} />
          </summary>
          <label>
            <span>Только память страницы</span>
            <span className="sr-only">Состояние демонстрации</span>
            <select
              value={scenario}
              onChange={(e) => {
                changeScenario(scenarioSchema.parse(e.target.value));
              }}
            >
              <option value="ready">В памяти</option>
              <option value="history">Пример сдач</option>
              <option value="unavailable">Ошибка отправки</option>
              <option value="version">Новая версия</option>
              <option value="closed">Приём закрыт</option>
              <option value="expired">Сессия закончилась</option>
            </select>
          </label>
        </details>
      </div>
    </div>
  );
}
