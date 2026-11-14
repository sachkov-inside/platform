import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  BookOpen,
  Check,
  CircleHelp,
  RefreshCw,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { calloutTonePresentation } from "@/entities/material/ui/material-blocks/callout-tone";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import "./lesson-visual-variants.css";

/*
 * Prototype for specification #2118: three colour schemes of the interactive lesson for the
 * owner's choice. Local copies of the production blocks with changed styling and static answers;
 * no production module imports this file. The chosen variant moves into the production blocks
 * after the owner's decision.
 */

type VariantId = "a" | "b" | "c";
type Theme = "light" | "dark";

interface Variant {
  readonly id: VariantId;
  readonly name: string;
  readonly rationale: string;
}

const variants: Record<VariantId, Variant> = {
  a: {
    id: "a",
    name: "A · Тёплая бумага",
    rationale:
      "Одна тёплая гамма: песочное «Определение», графитовая кнопка вопроса, оранжевый остаётся только у сайта. Самый спокойный вариант.",
  },
  b: {
    id: "b",
    name: "B · Морская волна",
    rationale:
      "Голос урока в одном сине-зелёном цвете: «Определение», кнопка вопроса и оборот карточки. Урок отличается от остального сайта, но не спорит с ним.",
  },
  c: {
    id: "c",
    name: "C · Графит и оранжевый",
    rationale:
      "Родная пара сайта: тёмная графитовая карточка «Определение» и оранжевая кнопка вопроса. Самый контрастный вариант, блоки урока видны издалека.",
  },
};

const terms = [
  {
    id: "observable",
    title: "Наблюдаемое поведение",
    english: "Observable behaviour",
    short:
      "То, что пользователь или другая система видят снаружи: ответ, запись, сообщение.",
  },
  {
    id: "acceptance",
    title: "Приёмочный критерий",
    english: "Acceptance criterion",
    short:
      "Проверяемое условие, при котором задачу считают сделанной. Его формулируют до работы.",
  },
  {
    id: "regression",
    title: "Регрессия",
    english: "Regression",
    short: "Поломка того, что раньше работало, после нового изменения.",
  },
] as const;

/* ------------------------------------------------------------------ lesson blocks */

function TermLink({ children }: { readonly children: ReactNode }) {
  return (
    // A span keeps the term inline: a button is inline-block and wraps as one piece on phones.
    <span
      className="cursor-help rounded-sm underline decoration-dotted decoration-[1.5px] underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
      role="button"
      style={{ textDecorationColor: "var(--lv-link)" }}
      tabIndex={0}
    >
      {children}
    </span>
  );
}

function DefinitionCard() {
  const presentation = calloutTonePresentation("definition");
  return (
    <aside
      aria-label="Определение: Наблюдаемое поведение"
      className="mt-8 rounded-xl border px-5 pt-4 pb-4 text-[0.9375rem] leading-7 sm:px-6"
      style={{
        background: "var(--lv-def-bg)",
        borderColor: "var(--lv-def-line)",
        color: "var(--lv-def-fg)",
      }}
    >
      <p
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: "var(--lv-def-ink)" }}
      >
        <presentation.icon aria-hidden="true" className="size-4 shrink-0" />
        {presentation.label}
      </p>
      <p className="mt-1 font-semibold">
        Наблюдаемое поведение (Observable behaviour)
      </p>
      <p className="mt-2">
        Всё, что система показывает наружу: ответ на запрос, запись в базе,
        письмо пользователю. Внутреннее устройство сюда не входит, поэтому
        проверка по наблюдаемому поведению переживает рефакторинг.
      </p>
    </aside>
  );
}

function Avatar() {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
      style={{ background: "var(--lv-ask-bg)", color: "var(--lv-ask-fg)" }}
    >
      АС
    </span>
  );
}

function StudentReply({ label }: { readonly label: string }) {
  return (
    <div className="mt-8 mb-2 flex items-end justify-end gap-2">
      <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">Анна Смирнова</span>
        <p
          className="rounded-2xl rounded-br-sm px-4 py-2.5"
          style={{
            background: "var(--lv-reply-bg)",
            color: "var(--lv-reply-fg)",
          }}
        >
          {label}
        </p>
      </div>
      <Avatar />
    </div>
  );
}

function StepQuestion({ label }: { readonly label: string }) {
  return (
    <div className="mt-10 flex justify-center">
      <button
        className="min-h-11 max-w-[90%] rounded-full bg-(--lv-ask-bg) px-5 py-2.5 text-center font-medium text-(--lv-ask-fg) shadow-sm hover:bg-(--lv-ask-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        type="button"
      >
        {label}
      </button>
    </div>
  );
}

function QuizAnswered() {
  const options = [
    { text: "Пользователь видит новую запись в списке.", chosen: true },
    { text: "Функция вызывает нужный метод репозитория.", chosen: false },
    { text: "Код написан на TypeScript.", chosen: false },
  ];
  return (
    <section
      aria-label="Упражнение 1 из 2"
      className="lv-surface my-6 rounded-xl p-3 text-sm leading-[1.55] sm:my-8 sm:p-5 sm:text-base"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold sm:text-base">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-lg sm:size-8"
          style={{
            background: "var(--lv-badge-bg)",
            color: "var(--lv-badge-fg)",
          }}
        >
          <CircleHelp aria-hidden="true" className="size-4 sm:size-5" />
        </span>
        Упражнение 1 из 2
      </h2>
      <p className="mt-3">Что лучше проверяет результат задачи?</p>
      <div className="mt-4 space-y-2" role="group" aria-label="Выберите ответ">
        {options.map((option, index) => (
          <div
            className="relative flex min-h-11 gap-2 rounded-lg border px-2.5 py-2 pr-8 text-sm leading-[1.5] sm:px-3 sm:pr-9 sm:text-base"
            data-quiz-option
            data-result={option.chosen ? "correct" : undefined}
            key={option.text}
            style={
              option.chosen
                ? undefined
                : {
                    background: "var(--lv-chip-bg)",
                    borderColor: "var(--lv-line)",
                  }
            }
          >
            <span className="font-semibold">{index + 1}.</span>
            <span>{option.text}</span>
            {option.chosen ? (
              <Check
                aria-hidden="true"
                className="absolute top-3 right-3 size-4"
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button
          className="min-h-11 px-2.5 text-sm sm:px-3"
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Ответить ещё раз
        </Button>
      </div>
      <p
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: "var(--callout-good)" }}
      >
        <Check aria-hidden="true" className="size-4 shrink-0" />
        Правильно
      </p>
      <p className="mt-2 text-muted-foreground">
        Запись в списке видна пользователю, её и проверяем.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ term deck */

function DeckCardFaces({
  term,
  turned,
}: {
  readonly term: (typeof terms)[number];
  readonly turned: boolean;
}) {
  return (
    <div className="lv-flip-inner" data-turned={turned ? "" : undefined}>
      <div
        aria-hidden={turned}
        className="lv-face lv-card-shadow flex min-h-60 flex-col items-center justify-center rounded-2xl px-6 py-8 text-center"
        style={{
          background: "var(--lv-front-bg)",
          color: "var(--lv-front-fg)",
        }}
      >
        <p className="text-2xl font-semibold tracking-[-0.02em] text-balance">
          {term.title}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--lv-front-sub)" }}>
          {term.english}
        </p>
        <p
          className="mt-8 flex items-center gap-1.5 text-xs font-medium"
          style={{ color: "var(--lv-front-sub)" }}
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Нажмите, чтобы перевернуть
        </p>
      </div>
      <div
        aria-hidden={!turned}
        className="lv-face lv-face-back lv-card-shadow flex min-h-60 flex-col justify-center rounded-2xl px-6 py-8"
        style={{ background: "var(--lv-back-bg)", color: "var(--lv-back-fg)" }}
      >
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--lv-back-sub)" }}
        >
          {term.title}
        </p>
        <p className="mt-2 text-lg leading-7 text-pretty">{term.short}</p>
      </div>
    </div>
  );
}

/** The card with the deck under it: two edges peek out below, so it reads as a pile of cards. */
function DeckPile({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative pb-3">
      <div
        aria-hidden="true"
        className="absolute inset-x-6 bottom-0 h-8 rounded-2xl"
        style={{ background: "var(--lv-stack)" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-3 bottom-1.5 h-8 rounded-2xl border"
        style={{
          background: "var(--lv-chip-bg)",
          borderColor: "var(--lv-line)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

function TermDeck() {
  const headingId = useId();
  const [index, setIndex] = useState(0);
  const [turned, setTurned] = useState(false);
  const [marks, setMarks] = useState<Record<string, "known" | "review">>({});
  const done = index >= terms.length;
  const term = terms[Math.min(index, terms.length - 1)] ?? terms[0];
  const known = Object.values(marks).filter((m) => m === "known").length;
  const review = Object.values(marks).filter((m) => m === "review").length;
  const mark = (value: "known" | "review") => {
    setMarks((current) => ({ ...current, [term.id]: value }));
    setTurned(false);
    setIndex((current) => current + 1);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="lv-surface mt-12 rounded-2xl p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold" id={headingId}>
          Термины урока
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {done ? terms.length : index + 1} из {terms.length}
        </p>
      </div>
      <div aria-hidden="true" className="mt-3 flex gap-1">
        {terms.map((item, position) => (
          <span
            className="h-1 flex-1 rounded-full"
            key={item.id}
            style={{
              background:
                position < index || done
                  ? "var(--lv-known-bg)"
                  : "var(--lv-line)",
            }}
          />
        ))}
      </div>

      <div className="mx-auto mt-5 max-w-md">
        {done ? (
          <div
            className="lv-card-shadow flex min-h-60 flex-col items-center justify-center rounded-2xl px-6 py-8 text-center"
            style={{
              background: "var(--lv-front-bg)",
              color: "var(--lv-front-fg)",
            }}
          >
            <p className="text-xl font-semibold">Колода пройдена</p>
            <p
              className="mt-2 text-sm"
              style={{ color: "var(--lv-front-sub)" }}
            >
              Знаю: {known}, повторить: {review}
            </p>
            <Button
              className="mt-5 min-h-11"
              onClick={() => {
                setIndex(0);
                setTurned(false);
              }}
              type="button"
              variant="outline"
            >
              Пройти ещё раз
            </Button>
          </div>
        ) : (
          <DeckPile>
            <button
              aria-label={
                turned
                  ? `Показать термин «${term.title}»`
                  : `Перевернуть карточку «${term.title}»`
              }
              className="lv-flip block w-full rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              onClick={() => {
                setTurned((value) => !value);
              }}
              type="button"
            >
              <DeckCardFaces term={term} turned={turned} />
            </button>
          </DeckPile>
        )}

        {done ? null : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => {
                mark("review");
              }}
              style={{
                background: "var(--lv-chip-bg)",
                borderColor: "var(--lv-line)",
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Повторить
            </button>
            <button
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => {
                mark("known");
              }}
              style={{
                background: "var(--lv-known-bg)",
                color: "var(--lv-known-fg)",
              }}
              type="button"
            >
              <Check aria-hidden="true" className="size-4" />
              Знаю
            </button>
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-sm">
        <a
          className="inline-flex min-h-11 items-center gap-1.5 text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href="#glossary"
        >
          <BookOpen aria-hidden="true" className="size-4" />
          Все термины курса
        </a>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ end of lesson */

function ExerciseSummary() {
  const solved = 1;
  const total = 2;
  return (
    <section
      aria-label="Упражнения урока"
      className="lv-surface mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-4 py-3 sm:px-6"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex gap-1">
          {Array.from({ length: total }, (_, position) => (
            <span
              className="grid size-6 place-items-center rounded-md"
              key={position}
              style={
                position < solved
                  ? {
                      background: "var(--lv-known-bg)",
                      color: "var(--lv-known-fg)",
                    }
                  : {
                      background: "var(--lv-chip-bg)",
                      border: "1px solid var(--lv-line)",
                    }
              }
            >
              {position < solved ? <Check className="size-3.5" /> : null}
            </span>
          ))}
        </span>
        <p className="font-semibold">
          Упражнения: {solved} из {total} решены
        </p>
      </div>
      <a
        className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        href="#exercise-2"
        style={{ color: "var(--lv-link)" }}
      >
        Решить упражнение 2
      </a>
    </section>
  );
}

function LessonRating() {
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const choices = [
    { value: "like", label: "Понравился", Icon: ThumbsUp },
    { value: "dislike", label: "Не понравился", Icon: ThumbsDown },
  ] as const;
  return (
    <section
      aria-labelledby="lv-rating"
      className="lv-surface mt-4 flex items-center justify-between gap-4 rounded-2xl py-2 pr-2 pl-4 sm:pl-6"
    >
      <div className="min-w-0">
        <h2 className="font-semibold" id="lv-rating">
          Как вам урок?
        </h2>
        <p className="text-xs text-muted-foreground" role="status">
          {rating === null ? "" : "Спасибо. Повторное нажатие снимает оценку."}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {choices.map(({ value, label, Icon }) => {
          const chosen = rating === value;
          return (
            <button
              aria-label={label}
              aria-pressed={chosen}
              className="grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              key={value}
              onClick={() => {
                setRating(chosen ? null : value);
              }}
              style={
                chosen
                  ? {
                      background: "var(--lv-known-bg)",
                      color: "var(--lv-known-fg)",
                    }
                  : { background: "var(--lv-chip-bg)" }
              }
              title={label}
              type="button"
            >
              <Icon aria-hidden="true" className="size-5" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

function Annotation({ variant }: { readonly variant: Variant }) {
  const swatches = [
    ["Определение", "var(--lv-def-bg)"],
    ["Вопрос", "var(--lv-ask-bg)"],
    ["Блоки", "var(--lv-surface)"],
    ["Оборот", "var(--lv-back-bg)"],
  ] as const;
  return (
    <header className="border-b border-dashed border-(--lv-line) px-4 py-4 sm:px-8">
      <div className="mx-auto max-w-[43rem]">
        <p className="text-lg font-semibold tracking-[-0.02em]">
          {variant.name}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {variant.rationale}
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {swatches.map(([label, color]) => (
            <li className="flex items-center gap-1.5" key={label}>
              <span
                aria-hidden="true"
                className="size-4 rounded-[5px] border border-(--lv-line)"
                style={{ background: color }}
              />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function DeckSides() {
  const term = terms[0];
  return (
    <section
      aria-label="Обе стороны карточки"
      className="mx-auto mt-14 max-w-[43rem] border-t border-dashed border-(--lv-line) pt-6"
    >
      <p className="text-sm text-muted-foreground">
        Прототип: обе стороны карточки рядом. В уроке карточка переворачивается
        нажатием.
      </p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {[false, true].map((turned) => (
          <figure key={String(turned)}>
            <div aria-hidden="true" className="lv-flip">
              <DeckCardFaces term={term} turned={turned} />
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">
              {turned ? "Оборот" : "Лицевая сторона"}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function LessonVariantPage({
  variant,
  theme,
}: {
  readonly variant: VariantId;
  readonly theme: Theme;
}) {
  const spec = variants[variant];
  return (
    <div
      className={cn("min-h-screen pb-16", theme === "dark" && "dark")}
      data-lv={variant}
      {...(theme === "light" ? { "data-public-shell": "" } : {})}
    >
      <Annotation variant={spec} />
      <main className="px-4 pt-8 sm:px-8">
        <article className="mx-auto max-w-[43rem] text-[0.9375rem] leading-[1.65] text-pretty sm:text-base xl:text-lg">
          <p className="text-xs text-muted-foreground sm:text-sm">
            <span className="font-semibold text-foreground">
              Курс «AI-инженерия»
            </span>{" "}
            · Урок 3
          </p>
          <h1 className="mt-3 text-[1.375rem] leading-[1.2] font-semibold tracking-[-0.025em] text-balance sm:mt-4 sm:text-2xl md:text-[1.75rem]">
            Как проверить, что задача сделана
          </h1>

          <p className="mt-8">
            Готовность задачи видна снаружи. Проверка начинается с{" "}
            <TermLink>наблюдаемого поведения</TermLink>: что именно увидит
            пользователь, когда всё работает.
          </p>

          <DefinitionCard />

          <StudentReply label="А если снаружи ничего не видно?" />

          <p className="mt-6">
            Тогда ищем след: запись в журнале, событие в очереди, письмо. Если
            следа нет, его стоит добавить до начала работы, вместе с приёмочным
            критерием.
          </p>

          <QuizAnswered />

          <p className="mt-6">
            Хорошая проверка переживает рефакторинг: внутренности меняются, а
            наблюдаемое поведение остаётся прежним.
          </p>

          <StepQuestion label="Как это выглядит в тесте?" />

          <TermDeck />
          <ExerciseSummary />
          <LessonRating />
        </article>
        <DeckSides />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ stories */

const meta = {
  title: "Prototypes/Lesson Visual Variants",
  component: LessonVariantPage,
  tags: ["!autodocs"],
  args: { variant: "a", theme: "light" },
  argTypes: {
    variant: { control: "inline-radio", options: ["a", "b", "c"] },
    theme: { control: "inline-radio", options: ["light", "dark"] },
  },
  parameters: { a11y: { test: "todo" } },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} satisfies Meta<typeof LessonVariantPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

export const VariantA: Story = {
  name: "A · Тёплая бумага",
  args: { variant: "a" },
};
export const VariantB: Story = {
  name: "B · Морская волна",
  args: { variant: "b" },
};
export const VariantC: Story = {
  name: "C · Графит и оранжевый",
  args: { variant: "c" },
};
export const VariantAMobile: Story = {
  name: "A · Тёплая бумага · 390",
  args: { variant: "a" },
  ...mobile,
};
export const VariantBMobile: Story = {
  name: "B · Морская волна · 390",
  args: { variant: "b" },
  ...mobile,
};
export const VariantCMobile: Story = {
  name: "C · Графит и оранжевый · 390",
  args: { variant: "c" },
  ...mobile,
};
