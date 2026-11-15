import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "@/shared/ui/button";
import { courseGuide } from "@/storybook/course-reading.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  CourseRail,
  CourseReadingFooter,
  CourseReadingHeader,
  ProgrammeDialog,
} from "./course-reading.client";
import styles from "./collapsible-lesson-menu-prototype.module.css";

// Throwaway (owner request 2026-11-15, #2158): the reader collapses the lesson menu on a wide
// screen. Three variants for the owner to compare; fixture data and in-memory state only, nothing in
// production imports this file. The choice is remembered per variant in this browser.

type Variant = "strip" | "header" | "wide";
type MenuState = "expanded" | "collapsed";

const storageKey = (variant: Variant) =>
  `prototype-2158-lesson-menu:${variant}`;

function readStoredState(variant: Variant): MenuState {
  try {
    return window.localStorage.getItem(storageKey(variant)) === "collapsed"
      ? "collapsed"
      : "expanded";
  } catch {
    return "expanded";
  }
}

function storeState(variant: Variant, state: MenuState) {
  try {
    window.localStorage.setItem(storageKey(variant), state);
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}

const paragraphs = [
  "Агент читает проект так же, как новый человек в команде: сначала инструкции в корне, потом код вокруг задачи. Чем точнее инструкции, тем меньше догадок.",
  "Начни с короткого файла AGENTS.md. В нём три вещи: как запустить проверки, где лежат правила кода и что агенту делать нельзя без твоего разрешения.",
  "Проверь настройку на маленькой задаче. Попроси агента исправить опечатку в README и посмотри, какие команды он запускает и что пишет в коммите.",
  "Если агент запускает не те проверки, поправь инструкцию, а не результат. Следующий запуск должен пройти без твоих подсказок.",
  "Когда маленькая задача проходит чисто, дай задачу побольше: новый эндпоинт с тестом. Смотри, где агент спрашивает, а где решает сам.",
  "Запиши в инструкцию решения, которые ты принял по ходу. Так их не придётся повторять в каждой сессии.",
  "В конце урока у тебя есть проект, где агент сам находит команды проверки, пишет тест до кода и не трогает то, что ты запретил.",
];

function CollapsibleLessonMenu({ variant }: { readonly variant: Variant }) {
  const context = courseGuide;
  const menuId = useId();
  const [state, setState] = useState<MenuState>(() => readStoredState(variant));
  const collapseButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  const expanded = state === "expanded";

  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    (expanded ? collapseButton : expandButton).current?.focus();
  }, [expanded]);

  const toggle = (next: MenuState) => {
    focusAfterToggle.current = true;
    setState(next);
    storeState(variant, next);
  };

  const headerToggle =
    variant === "header" ? (
      <Button
        ref={expanded ? undefined : expandButton}
        variant="outline"
        className={styles["headerToggle"]}
        aria-expanded={expanded}
        aria-controls={menuId}
        onClick={() => {
          toggle(expanded ? "collapsed" : "expanded");
        }}
      >
        {expanded ? (
          <PanelLeftClose aria-hidden="true" />
        ) : (
          <PanelLeftOpen aria-hidden="true" />
        )}
        Программа
      </Button>
    ) : undefined;

  return (
    <div
      className={styles["frame"]}
      data-variant={variant}
      data-menu={state}
      data-prototype-lesson-menu
    >
      <aside
        id={menuId}
        className={styles["menu"]}
        hidden={!expanded}
        aria-label="Меню уроков"
      >
        <Button
          ref={collapseButton}
          variant="ghost"
          size="icon"
          className={`${styles["collapse"] ?? ""} ${styles["iconButton"] ?? ""}`}
          aria-label="Свернуть меню уроков"
          title="Свернуть меню уроков"
          aria-expanded={true}
          aria-controls={menuId}
          onClick={() => {
            toggle("collapsed");
          }}
        >
          <PanelLeftClose aria-hidden="true" />
        </Button>
        <CourseRail context={context} />
      </aside>
      {!expanded && variant !== "header" ? (
        <div className={styles["strip"]}>
          <Button
            ref={expandButton}
            variant="ghost"
            size="icon"
            className={styles["iconButton"]}
            aria-label="Развернуть меню уроков"
            title="Развернуть меню уроков"
            aria-expanded={false}
            aria-controls={menuId}
            onClick={() => {
              toggle("expanded");
            }}
          >
            <PanelLeftOpen aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <div className={styles["document"]}>
        <ProgrammeDialog context={context} supplementary={false} />
        <CourseReadingHeader
          context={context}
          title="Как устроен курс"
          metadata={<span>Гайд · AI Engineering</span>}
          actions={headerToggle}
        />
        <div className={styles["prose"]}>
          {paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
        <CourseReadingFooter context={context} />
      </div>
    </div>
  );
}

const meta = {
  ...publicPageEnvironment("/materials/course-intro"),
  id: "prototypes-2158-lesson-menu",
  title: "Prototypes/2158 Сворачивание меню уроков",
  component: CollapsibleLessonMenu,
  args: { variant: "strip" },
  beforeEach: () => {
    // Each review starts expanded; the owner's later choice is still remembered while clicking.
    for (const variant of ["strip", "header", "wide"] as const) {
      try {
        window.localStorage.removeItem(storageKey(variant));
      } catch {
        // Storage unavailable.
      }
    }
  },
} satisfies Meta<typeof CollapsibleLessonMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

const expandCollapseRoundTrip = (expandName: RegExp) =>
  async function play({ canvasElement }: { canvasElement: HTMLElement }) {
    const canvas = within(canvasElement);
    const collapse = canvas.queryByRole("button", {
      name: "Свернуть меню уроков",
    });
    // Below 64rem the menu lives in the bottom «Программа» panel; nothing to collapse.
    if (collapse === null || collapse.getClientRects().length === 0) return;
    const frame = canvasElement.querySelector("[data-prototype-lesson-menu]");
    await userEvent.click(collapse);
    await expect(frame).toHaveAttribute("data-menu", "collapsed");
    const expand = canvas.getByRole("button", { name: expandName });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(expand).toHaveFocus());
    await expect(
      window.localStorage.getItem(
        storageKey(frame?.getAttribute("data-variant") as Variant),
      ),
    ).toBe("collapsed");
    await userEvent.keyboard("{Enter}");
    await expect(frame).toHaveAttribute("data-menu", "expanded");
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Свернуть меню уроков" }),
      ).toHaveFocus(),
    );
  };

/** Вариант 1: на месте меню узкая полоса, урок прежней ширины по центру. */
export const Strip: Story = {
  name: "1. Узкая полоса",
  args: { variant: "strip" },
  play: expandCollapseRoundTrip(/^Развернуть меню уроков$/),
};

/** Вариант 2: меню скрывается целиком, кнопка «Программа» в шапке урока возвращает его. */
export const HeaderButton: Story = {
  name: "2. Кнопка «Программа» в шапке",
  args: { variant: "header" },
  play: expandCollapseRoundTrip(/^Программа$/),
};

/** Вариант 3: как первый, но урок занимает освободившееся место. */
export const WideLesson: Story = {
  name: "3. Полоса, урок шире",
  args: { variant: "wide" },
  play: expandCollapseRoundTrip(/^Развернуть меню уроков$/),
};
