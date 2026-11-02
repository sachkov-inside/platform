/**
 * PROTOTYPE, не для main. Вопрос: как в строке урока программы показать видео, его длительность,
 * бесплатность и замок, чтобы у гостя и у купившего строки выглядели ровно и понятно.
 * Каждый вариант рисует одну главу дважды: глазами гостя и глазами купившего курс.
 * Разметка самодельная, на данных из скриншота; production-модули не импортируются.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowRight,
  Check,
  FileText,
  LockKeyhole,
  Play,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

interface Lesson {
  readonly n: number;
  readonly title: string;
  readonly duration?: string;
  readonly free: boolean;
}

const lessons: readonly Lesson[] = [
  { n: 1, title: "Как устроен курс", free: true },
  { n: 2, title: "Выбор агента и модели", duration: "9:23", free: true },
  {
    n: 3,
    title: "Как агент работает с проектом: контекст, инструменты и harness",
    duration: "7:07",
    free: true,
  },
  {
    n: 4,
    title: "Подготовка проекта: инструкции, скиллы и репозиторий",
    duration: "9:25",
    free: true,
  },
  {
    n: 5,
    title: "Начинаем работу с агентом в проекте",
    duration: "14:31",
    free: true,
  },
  {
    n: 6,
    title: "Первая версия продукта: сценарии и границы",
    duration: "4:16",
    free: true,
  },
  {
    n: 7,
    title: "Проектирование с агентом через grilling",
    duration: "23:40",
    free: true,
  },
  { n: 8, title: "Домен и общий язык", duration: "5:52", free: false },
  {
    n: 9,
    title: "Цикл разработки от спецификации: от обсуждения до pull request",
    free: false,
  },
  {
    n: 10,
    title: "Выбор стека и границ модулей",
    duration: "12:37",
    free: false,
  },
  {
    n: 11,
    title: "Практика: от спецификации к работающему приложению",
    duration: "34:35",
    free: false,
  },
  {
    n: 12,
    title: "Настройка тестов, проверок архитектуры и CI",
    free: false,
  },
  {
    n: 13,
    title: "Итоги: готовность проекта к разработке функций",
    free: false,
  },
];

type Viewer = "guest" | "owner";

interface RowState {
  readonly lesson: Lesson;
  readonly viewer: Viewer;
  readonly locked: boolean;
  readonly freeMark: boolean;
  readonly read: boolean;
  readonly current: boolean;
}

function rowState(lesson: Lesson, viewer: Viewer): RowState {
  return {
    lesson,
    viewer,
    locked: viewer === "guest" && !lesson.free,
    freeMark: viewer === "guest" && lesson.free,
    read: viewer === "owner" && lesson.n === 1,
    current: viewer === "owner" && lesson.n === 11,
  };
}

const rowBase =
  "relative flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-muted/65 px-3 py-2.5 transition-colors hover:bg-muted sm:px-4";
const numberClass =
  "w-5 shrink-0 text-xs font-semibold tabular-nums sm:w-7 sm:text-center sm:text-lg";
const titleClass =
  "min-w-0 flex-[1_1_112px] text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6";

function ContinueButton() {
  return (
    <span className="inline-flex min-h-8 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground sm:text-[0.8125rem]">
      Продолжить
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </span>
  );
}

function Duration({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      <Play aria-hidden="true" className="size-3 fill-current" />
      {value}
    </span>
  );
}

function FreePill() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-accent/12 px-2 py-0.5 text-[0.6875rem] font-semibold leading-4 text-action">
      Бесплатно
    </span>
  );
}

/* ---------- 0. Сейчас: копия текущей строки для сравнения ---------- */

function RowCurrent({ s }: { readonly s: RowState }) {
  const { lesson } = s;
  return (
    <li className={rowBase}>
      <span className={numberClass}>{lesson.n}</span>
      <span className={titleClass}>{lesson.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {s.current ? <ContinueButton /> : null}
        {lesson.duration === undefined ? null : (
          <Duration value={lesson.duration} />
        )}
        <span className="flex min-w-[4.25rem] justify-end text-xs">
          {s.locked ? (
            <LockKeyhole className="size-4 text-muted-foreground" />
          ) : s.read ? (
            <Check className="size-4 text-action" />
          ) : s.freeMark ? (
            <span className="font-medium text-action">Бесплатно</span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/* ---------- A. Подпись под названием ---------- */

function RowA({ s }: { readonly s: RowState }) {
  const { lesson } = s;
  return (
    <li className={cn(rowBase, "items-start sm:items-center")}>
      <span className={cn(numberClass, "pt-0.5 sm:pt-0")}>{lesson.n}</span>
      <span className="min-w-0 flex-[1_1_112px]">
        <span
          className={cn(
            "block text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6",
            s.locked && "text-foreground/70",
          )}
        >
          {lesson.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {lesson.duration === undefined ? (
            <span className="inline-flex items-center gap-1">
              <FileText aria-hidden="true" className="size-3.5" />
              Текст
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Play aria-hidden="true" className="size-3 fill-current" />
              Видео · {lesson.duration}
            </span>
          )}
          {s.freeMark ? <FreePill /> : null}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3 self-center">
        {s.current ? <ContinueButton /> : null}
        {s.locked ? (
          <LockKeyhole
            aria-label="Нужен доступ"
            className="size-4 text-muted-foreground"
          />
        ) : s.read ? (
          <Check aria-label="Изучен" className="size-4 text-action" />
        ) : null}
      </span>
    </li>
  );
}

/* ---------- B. Значок формата слева ---------- */

function RowB({ s }: { readonly s: RowState }) {
  const { lesson } = s;
  const video = lesson.duration !== undefined;
  const Icon = s.read
    ? Check
    : s.locked
      ? LockKeyhole
      : video
        ? Play
        : FileText;
  return (
    <li className={rowBase}>
      <span className={numberClass}>{lesson.n}</span>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          s.read
            ? "bg-action text-white"
            : s.locked
              ? "bg-black/6 text-muted-foreground"
              : s.freeMark
                ? "bg-accent/15 text-action"
                : "bg-primary text-primary-foreground",
        )}
      >
        <Icon
          className={cn(
            "size-4",
            Icon === Play && "ml-0.5 size-3.5 fill-current",
          )}
        />
      </span>
      <span className={cn(titleClass, s.locked && "text-foreground/70")}>
        {lesson.title}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {s.current ? <ContinueButton /> : null}
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
          {lesson.duration ?? ""}
        </span>
      </span>
    </li>
  );
}

function LegendB() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="grid size-5 place-items-center rounded bg-accent/15 text-action">
          <Play className="ml-px size-2.5 fill-current" />
        </span>
        Бесплатно, после входа через Telegram
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="grid size-5 place-items-center rounded bg-black/6">
          <LockKeyhole className="size-3" />
        </span>
        С доступом к курсу
      </span>
    </p>
  );
}

/* ---------- C. Группы доступа ---------- */

function RowC({ s }: { readonly s: RowState }) {
  const { lesson } = s;
  return (
    <li className={rowBase}>
      <span className={numberClass}>{lesson.n}</span>
      <span className={cn(titleClass, s.locked && "text-foreground/70")}>
        {lesson.title}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {s.current ? <ContinueButton /> : null}
        <span className="flex w-14 justify-end">
          {lesson.duration === undefined ? null : (
            <Duration value={lesson.duration} />
          )}
        </span>
        <span className="flex w-4 justify-end">
          {s.read ? (
            <Check aria-label="Изучен" className="size-4 text-action" />
          ) : s.locked ? (
            <LockKeyhole
              aria-label="Нужен доступ"
              className="size-3.5 text-muted-foreground/70"
            />
          ) : null}
        </span>
      </span>
    </li>
  );
}

function GroupHeadingC({
  icon,
  title,
  note,
  tone,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly note: string;
  readonly tone: "free" | "locked";
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 pt-3 pb-1 text-sm font-semibold first:pt-0",
        tone === "free" ? "text-action" : "text-foreground",
      )}
    >
      {icon}
      {title}
      <span className="text-xs font-normal text-muted-foreground">{note}</span>
    </li>
  );
}

function ListC({ viewer }: { readonly viewer: Viewer }) {
  if (viewer === "owner") {
    return (
      <ol className="grid gap-2">
        {lessons.map((l) => (
          <RowC key={l.n} s={rowState(l, viewer)} />
        ))}
      </ol>
    );
  }
  const free = lessons.filter((l) => l.free);
  const paid = lessons.filter((l) => !l.free);
  return (
    <ol className="grid gap-2">
      <GroupHeadingC
        icon={<Send aria-hidden="true" className="size-4" />}
        note={`${String(free.length)} уроков · откроются после входа через Telegram`}
        title="Бесплатно"
        tone="free"
      />
      {free.map((l) => (
        <RowC key={l.n} s={{ ...rowState(l, viewer), locked: false }} />
      ))}
      <GroupHeadingC
        icon={<LockKeyhole aria-hidden="true" className="size-4" />}
        note={`${String(paid.length)} уроков`}
        title="С доступом к курсу"
        tone="locked"
      />
      {paid.map((l) => (
        <RowC key={l.n} s={{ ...rowState(l, viewer), locked: false }} />
      ))}
    </ol>
  );
}

/* ---------- D. Отметки у названия и в номере ---------- */

function RowD({ s }: { readonly s: RowState }) {
  const { lesson } = s;
  return (
    <li className={rowBase}>
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums sm:size-8 sm:text-sm",
          s.read ? "bg-action text-white" : "bg-white text-foreground",
          s.locked && "text-muted-foreground",
        )}
      >
        {s.read ? <Check aria-label="Изучен" className="size-4" /> : lesson.n}
      </span>
      <span className={cn(titleClass, s.locked && "text-foreground/70")}>
        {lesson.title}
        {s.freeMark ? (
          <>
            {" "}
            <span className="relative -top-px ml-1 inline-block align-middle">
              <FreePill />
            </span>
          </>
        ) : null}
        {s.locked ? (
          <LockKeyhole
            aria-label="Нужен доступ"
            className="relative -top-px ml-1.5 inline size-3.5 align-middle text-muted-foreground"
          />
        ) : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {s.current ? <ContinueButton /> : null}
        <span className="w-14 text-right">
          {lesson.duration === undefined ? (
            <span className="text-xs text-muted-foreground/60">текст</span>
          ) : (
            <Duration value={lesson.duration} />
          )}
        </span>
      </span>
    </li>
  );
}

/* ---------- Рамка: одна глава глазами гостя и купившего ---------- */

function Chapter({
  viewer,
  list,
  legend,
}: {
  readonly viewer: Viewer;
  readonly list: ReactNode;
  readonly legend?: ReactNode;
}) {
  return (
    <section className="@container/programme min-w-0">
      <p className="mb-3 inline-flex rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
        {viewer === "guest" ? "Гость, курс не куплен" : "Купил курс"}
      </p>
      <div className="flex items-start gap-3">
        <span className="mt-2 size-3 shrink-0 rounded-full bg-accent" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight tracking-[-0.02em] sm:text-xl">
            Подготовка проекта и первый цикл разработки с агентом
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {viewer === "guest" ? "0 из 13" : "1 из 13"}
          </p>
        </div>
      </div>
      {legend === undefined ? null : <div className="mt-3">{legend}</div>}
      <div className="mt-4">{list}</div>
    </section>
  );
}

function Compare({
  render,
}: {
  readonly render: (viewer: Viewer) => {
    list: ReactNode;
    legend?: ReactNode;
  };
}) {
  return (
    <div className="mx-auto grid max-w-[96rem] gap-12 p-4 sm:p-8 xl:grid-cols-2">
      {(["guest", "owner"] as const).map((viewer) => {
        const { list, legend } = render(viewer);
        return (
          <Chapter
            key={viewer}
            viewer={viewer}
            list={list}
            {...(legend === undefined ? {} : { legend })}
          />
        );
      })}
    </div>
  );
}

function simpleList(
  Row: (props: { readonly s: RowState }) => ReactNode,
  viewer: Viewer,
) {
  return (
    <ol className="grid gap-2">
      {lessons.map((l) => (
        <Row key={l.n} s={rowState(l, viewer)} />
      ))}
    </ol>
  );
}

const meta = {
  title: "Prototypes/Lesson row",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Now: Story = {
  name: "0. Сейчас",
  render: () => (
    <Compare render={(v) => ({ list: simpleList(RowCurrent, v) })} />
  ),
};

export const SubtitleMeta: Story = {
  name: "A. Подпись под названием",
  render: () => <Compare render={(v) => ({ list: simpleList(RowA, v) })} />,
};

export const FormatTile: Story = {
  name: "B. Значок формата слева",
  render: () => (
    <Compare
      render={(v) => ({
        list: simpleList(RowB, v),
        ...(v === "guest" ? { legend: <LegendB /> } : {}),
      })}
    />
  ),
};

export const AccessGroups: Story = {
  name: "C. Группы доступа",
  render: () => <Compare render={(v) => ({ list: <ListC viewer={v} /> })} />,
};

export const InlineMarks: Story = {
  name: "D. Отметки у названия и в номере",
  render: () => <Compare render={(v) => ({ list: simpleList(RowD, v) })} />,
};
