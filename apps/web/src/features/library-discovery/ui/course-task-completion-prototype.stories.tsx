import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowLeft, ArrowRight, Check, CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  courseReadingContext,
  type CourseReadingContext,
  type CourseReadingStep,
} from "../model/course-reading";
import {
  CourseReadingHeader,
  CourseReadingLayout,
} from "./course-reading.client";
import { courseSource } from "@/storybook/course-reading.fixtures";
import {
  PublicShellFrame,
  publicPageEnvironment,
} from "@/storybook/story-environment";
import styles from "./course-task-completion.prototype.module.css";

// Throwaway: three sidebar treatments of a persisted submission, using the real Reader shell.
// No completion/acceptance field exists. These fixture marks mean submitted, never passed.
const variants = ["Тихое зачёркивание", "Галочка и подпись", "Узел на линии"];
const scenarios = ["Открыто новое", "Открыто сданное", "Отчёт без отправки"];
const sourceTask = courseSource.chapters[0].tasks[0];
const series = {
  ...courseSource,
  chapters: [
    {
      ...courseSource.chapters[0],
      name: "Подготовь проект к разработке",
      tasks: [
        {
          ...sourceTask,
          code: "harness",
          title: "Подготовь проект к работе с агентом",
          afterMaterialId: "first-id",
          lastSubmittedAt: "2026-10-14T09:00:00.000Z",
        },
        {
          ...sourceTask,
          code: "foundation",
          title: "Заложи основу проекта",
          afterMaterialId: "first-id",
          lastSubmittedAt: null,
        },
      ],
    },
    {
      ...courseSource.chapters[1],
      tasks: [
        {
          ...sourceTask,
          code: "next-chapter",
          title: "Спроектируй MVP",
          afterMaterialId: null,
          lastSubmittedAt: null,
        },
      ],
    },
  ],
};
function contextFor(code: string): CourseReadingContext {
  const context = courseReadingContext({
    series,
    current: { kind: "task", code },
  });
  if (context === null)
    throw new Error("Prototype Task must belong to its chapter");
  return context;
}
const submitted = new Set(
  series.chapters.flatMap((chapter) =>
    chapter.tasks
      .filter((task) => task.lastSubmittedAt !== null)
      .map((task) => `task:${task.code}`),
  ),
);
const fallbackContext = contextFor("foundation");
const contexts = [
  contextFor("foundation"),
  contextFor("harness"),
  contextFor("foundation"),
];
const environment = publicPageEnvironment(
  "/products/ai-engineering/tasks/foundation",
);

function readChoice(name: string, max: number): number {
  const value = new URL(window.location.href).searchParams.get(name);
  const index =
    name === "variant"
      ? ["A", "B", "C"].indexOf(value ?? "A")
      : Number(value ?? "0");
  return index >= 0 && index < max ? index : 0;
}
function TaskLabel({
  step,
  variant,
  current,
}: {
  step: CourseReadingStep;
  variant: number;
  current: boolean;
}) {
  const done = submitted.has(step.id);
  return (
    <span className={styles["label"]}>
      <span className={styles["meta"]}>
        <small>Задание {step.taskOrdinal}</small>
        {current && <span className={styles["current"]}>Открыто</span>}
      </span>
      <span className={styles["title"]}>{step.title}</span>
      {done && (
        <>
          <span className={styles["status"]}>
            {variant === 0 ? "Сдано 14 октября" : "Сдано"}
          </span>
          {variant === 1 && (
            <CircleCheck
              className={styles["check"]}
              size={17}
              aria-hidden="true"
            />
          )}
          {variant === 2 && (
            <span className={styles["node"]}>
              <Check size={12} aria-hidden="true" />
            </span>
          )}
        </>
      )}
    </span>
  );
}
function Comparison() {
  const [variant, setVariant] = useState(() => readChoice("variant", 3));
  const [scenario, setScenario] = useState(() => readChoice("state", 3));
  const root = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<
    { element: HTMLElement; step: CourseReadingStep }[]
  >([]);
  const context = contexts[scenario] ?? fallbackContext;
  function changeVariant(value: number) {
    const next = (value + 3) % 3;
    setVariant(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", ["A", "B", "C"][next] ?? "A");
    history.replaceState(null, "", url);
  }
  function changeScenario(value: number) {
    setScenario(value);
    const url = new URL(location.href);
    url.searchParams.set("state", String(value));
    history.replaceState(null, "", url);
  }
  useEffect(() => {
    const steps = new Map(
      context.chapters
        .flatMap((chapter) => chapter.steps)
        .filter((step) => step.kind === "task")
        .map((step) => [step.id, step]),
    );
    const nodes = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-course-step]") ?? [],
    );
    const selected = nodes.flatMap((element) => {
      const step = steps.get(element.dataset["courseStep"] ?? "");
      if (!step) return [];
      element.dataset["prototypeTask"] = "true";
      element.dataset["prototypeSubmitted"] = String(submitted.has(step.id));
      return [{ element, step }];
    });
    setTargets(selected);
    return () => {
      for (const { element } of selected) {
        delete element.dataset["prototypeTask"];
        delete element.dataset["prototypeSubmitted"];
      }
    };
  }, [context]);
  useEffect(() => {
    const sync = () => {
      setVariant(readChoice("variant", 3));
      setScenario(readChoice("state", 3));
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input,textarea,select,[contenteditable=true],[role=combobox],[role=menu]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        changeVariant(variant + (event.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("keydown", key);
    };
  }, [variant]);
  return (
    <div
      ref={root}
      className={styles["host"]}
      data-variant={["A", "B", "C"][variant]}
    >
      <CourseReadingLayout context={context}>
        <CourseReadingHeader
          context={context}
          title={context.current.title}
          metadata={null}
        />
        <section className={styles["explanation"]}>
          <h2>Как показывать сдачу в программе</h2>
          <p>
            Вариант {String.fromCharCode(65 + variant)}: {variants[variant]}.
          </p>
          <div className={styles["scenarios"]} aria-label="Состояния задания">
            {scenarios.map((label, index) => (
              <button
                key={label}
                aria-pressed={scenario === index}
                onClick={() => {
                  changeScenario(index);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            {scenario === 0
              ? "Задание 1 сдано. Сейчас открыто задание 2: у него ещё нет сохранённой сдачи."
              : scenario === 1
                ? "Сейчас открыто уже сданное задание 1. Отметка сдачи остаётся, текущая позиция показывается отдельно."
                : "Агент подготовил отчёт по заданию 2, но ученик ещё не подтвердил отправку. У задания 2 нет отметки сдачи."}
          </p>
          <h3>Что означает отметка</h3>
          <p>
            «Сдано» означает сохранённую попытку. Это не оценка и не принятие
            работы автором. Просмотр страницы и готовый отчёт без отправки не
            меняют эту отметку.
          </p>
          <p>
            В текущих данных нет отдельного статуса «Завершено». Даже сдача с
            замечаниями сохраняется как сдача. Поэтому прототип не называет её
            успешным завершением.
          </p>
          <p className={styles["fixtureNote"]}>
            Прототип · данные примера. Номера заданий начинаются с 1 в каждой
            главе.
          </p>
        </section>
      </CourseReadingLayout>
      {targets.map(({ element, step }, index) =>
        createPortal(
          <TaskLabel
            step={step}
            variant={variant}
            current={step.id === context.current.id}
          />,
          element,
          `${step.id}:${String(index)}`,
        ),
      )}
      {process.env.NODE_ENV !== "production" && (
        <nav className={styles["switcher"]} aria-label="Варианты отметки сдачи">
          <button
            aria-label="Предыдущий вариант"
            onClick={() => {
              changeVariant(variant - 1);
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <small>Прототип · {String.fromCharCode(65 + variant)} из A–C</small>
            <strong>{variants[variant]}</strong>
          </div>
          <button
            aria-label="Следующий вариант"
            onClick={() => {
              changeVariant(variant + 1);
            }}
          >
            <ArrowRight size={18} />
          </button>
        </nav>
      )}
    </div>
  );
}
const meta = {
  title: "Prototypes/Reader Task Completion",
  component: Comparison,
  beforeEach: environment.beforeEach,
  parameters: environment.parameters,
  decorators: [
    (Story) => (
      <PublicShellFrame
        account="authenticated"
        currentPath="/products/ai-engineering/tasks/foundation"
      >
        <Story />
      </PublicShellFrame>
    ),
  ],
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compare: Story = {};
