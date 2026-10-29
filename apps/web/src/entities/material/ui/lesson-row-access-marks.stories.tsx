/**
 * PROTOTYPE, не для main. Варианты правой части строки программы: метка «Бесплатно», длительность
 * видео и замок. Разметка строки скопирована из `ProductMaterialRow` (material-card.tsx), чтобы
 * сравнивать только отметки. Ветка `prototype/lesson-row-access-marks`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheck, LockKeyhole, LockKeyholeOpen, Play } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type Reader = "guest" | "member";

interface Lesson {
  readonly title: string;
  readonly duration?: string;
  readonly free: boolean;
  readonly read?: boolean;
}

const lessons: readonly Lesson[] = [
  { title: "Как устроен курс", free: true, read: true },
  {
    title: "Выбор агента и модели",
    duration: "9:23",
    free: true,
    read: true,
  },
  {
    title: "Контекст, инструменты и harness агента",
    duration: "7:07",
    free: true,
  },
  {
    title: "Инструкции, скиллы и рабочее окружение",
    duration: "9:25",
    free: true,
  },
  {
    title: "Начинаем работу с агентом в проекте",
    duration: "14:31",
    free: true,
  },
  {
    title: "Первая версия продукта: сценарии и границы",
    duration: "4:16",
    free: false,
  },
  { title: "Домен и общий язык", duration: "5:52", free: false },
  { title: "Выбор стека и границ модулей", duration: "12:37", free: false },
  { title: "Тестирование, проверки архитектуры и CI", free: false },
  { title: "Цикл разработки: от обсуждения до pull request", free: false },
  { title: "Итоги: основа проекта и процесс разработки", free: false },
];

type Variant =
  "current" | "column" | "columnAccent" | "caption" | "byTitle" | "icons";

const variantNames: Record<Variant, string> = {
  current: "Сейчас",
  column: "1. Один столбец доступа",
  columnAccent: "1б. Один столбец доступа, акцентный цвет",
  caption: "2. Общая подпись вместо меток",
  byTitle: "3. Метка у названия",
  icons: "4. Значки вместо слова",
};

function ReadMark() {
  return (
    <>
      <CircleCheck aria-hidden="true" className="size-4 text-foreground" />
      <span className="sr-only">Просмотрено</span>
    </>
  );
}

function Lock() {
  return (
    <>
      <LockKeyhole aria-hidden="true" className="size-4" />
      <span className="sr-only">Нужен доступ</span>
    </>
  );
}

function Duration({
  value,
  fixed = false,
}: {
  readonly value: string | undefined;
  readonly fixed?: boolean;
}) {
  if (value === undefined) {
    return fixed ? <span aria-hidden="true" className="w-12 shrink-0" /> : null;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        fixed && "w-12 shrink-0 justify-end",
      )}
    >
      <Play aria-hidden="true" className="size-3 fill-current" />
      <span className="sr-only">Видео, </span>
      {value}
    </span>
  );
}

function CurrentBadge() {
  return (
    <span className="inline-flex shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold leading-4 text-secondary-foreground">
      Бесплатно
    </span>
  );
}

/** Правая часть строки для каждого варианта. */
function Trailing({
  lesson,
  reader,
  variant,
}: {
  readonly lesson: Lesson;
  readonly reader: Reader;
  readonly variant: Variant;
}) {
  const locked = reader === "guest" && !lesson.free;
  const read = reader === "member" && lesson.read === true;
  // Подписчику метка «Бесплатно» не нужна: ему открыто всё.
  const showFree = reader === "guest" && lesson.free;

  switch (variant) {
    case "current":
      return (
        <>
          {showFree ? <CurrentBadge /> : null}
          <Duration value={lesson.duration} />
          <span className="grid w-5 shrink-0 place-items-center">
            {locked ? <Lock /> : read ? <ReadMark /> : null}
          </span>
        </>
      );
    case "column":
    case "columnAccent":
      return (
        <>
          <Duration fixed value={lesson.duration} />
          <span
            className={cn(
              "flex shrink-0 justify-end",
              // Подписчику слово не показывается, поэтому столбец сужается до значка.
              reader === "guest" ? "w-[4.25rem]" : "w-5",
            )}
          >
            {showFree ? (
              <span
                className={cn(
                  "text-xs font-medium",
                  variant === "columnAccent"
                    ? "text-action"
                    : "text-foreground",
                )}
              >
                Бесплатно
              </span>
            ) : locked ? (
              <Lock />
            ) : read ? (
              <ReadMark />
            ) : null}
          </span>
        </>
      );
    case "caption":
    case "byTitle":
      return (
        <>
          <Duration fixed value={lesson.duration} />
          <span className="grid w-5 shrink-0 place-items-center">
            {locked ? <Lock /> : read ? <ReadMark /> : null}
          </span>
        </>
      );
    case "icons":
      return (
        <>
          <Duration fixed value={lesson.duration} />
          <span className="grid w-5 shrink-0 place-items-center">
            {showFree ? (
              <>
                <LockKeyholeOpen
                  aria-hidden="true"
                  className="size-4 text-action"
                />
                <span className="sr-only">Бесплатно</span>
              </>
            ) : locked ? (
              <Lock />
            ) : read ? (
              <ReadMark />
            ) : null}
          </span>
        </>
      );
  }
}

function Row({
  lesson,
  ordinal,
  reader,
  variant,
}: {
  readonly lesson: Lesson;
  readonly ordinal: number;
  readonly reader: Reader;
  readonly variant: Variant;
}) {
  const showFreeByTitle =
    variant === "byTitle" && reader === "guest" && lesson.free;
  return (
    <article className="group/row relative flex min-h-14 min-w-0 flex-col justify-center rounded-xl bg-muted/65 px-3 py-2.5 transition-colors hover:bg-muted sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <span
          aria-hidden="true"
          className="w-4 shrink-0 text-left text-xs font-semibold leading-5 tabular-nums text-foreground sm:w-7 sm:text-center sm:text-lg sm:leading-6"
        >
          {ordinal}
        </span>
        <div className="min-w-0 flex-[1_1_112px]">
          <h4 className="min-w-0 text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6">
            <a
              className="no-underline after:absolute after:inset-0 after:rounded-xl"
              href="#lesson"
            >
              {lesson.title}
            </a>
            {showFreeByTitle ? (
              <span className="ml-2 align-middle text-xs font-medium text-action">
                Бесплатно
              </span>
            ) : null}
          </h4>
        </div>
        <span className="ml-auto flex max-w-full shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground sm:gap-3">
          <Trailing lesson={lesson} reader={reader} variant={variant} />
        </span>
      </div>
    </article>
  );
}

function Chapter({
  reader,
  variant,
}: {
  readonly reader: Reader;
  readonly variant: Variant;
}) {
  const freeCount = lessons.filter((lesson) => lesson.free).length;
  const showCaption = variant === "caption" && reader === "guest";
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 text-sm sm:text-base">
        <span className="font-medium text-foreground">Темы и практика</span>
        <span className="text-xs tabular-nums text-muted-foreground sm:text-sm">
          {reader === "member" ? "2 из 11" : "0 из 11"}
        </span>
      </div>
      {showCaption ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-action">
            Уроки 1–{freeCount} бесплатно
          </span>{" "}
          после входа через Telegram.
        </p>
      ) : null}
      <ol className="grid gap-2">
        {lessons.map((lesson, index) => (
          <li key={lesson.title}>
            {showCaption && index === freeCount ? (
              <p className="px-1 pt-2 pb-2 text-xs text-muted-foreground">
                Дальше с доступом к курсу
              </p>
            ) : null}
            <Row
              lesson={lesson}
              ordinal={index + 1}
              reader={reader}
              variant={variant}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Preview({
  reader,
  variant,
}: {
  readonly reader: Reader;
  readonly variant: Variant;
}) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 text-foreground">
      <h3 className="text-lg font-semibold">{variantNames[variant]}</h3>
      <Chapter reader={reader} variant={variant} />
    </div>
  );
}

const meta = {
  title: "Prototypes/Lesson Row Access Marks",
  component: Preview,
  args: { reader: "guest", variant: "column" },
  argTypes: {
    reader: {
      control: "inline-radio",
      options: ["guest", "member"],
      description: "guest: гость или без покупки; member: есть доступ к курсу",
    },
    variant: {
      control: "select",
      options: Object.keys(variantNames),
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = { args: { variant: "current" } };
export const AccessColumn: Story = { args: { variant: "column" } };
export const AccessColumnAccent: Story = { args: { variant: "columnAccent" } };
export const GroupCaption: Story = { args: { variant: "caption" } };
export const LabelByTitle: Story = { args: { variant: "byTitle" } };
export const Icons: Story = { args: { variant: "icons" } };
export const MemberView: Story = {
  args: { variant: "column", reader: "member" },
};

/** Все варианты подряд, чтобы сравнить на одной странице. */
export const Comparison: Story = {
  render: ({ reader }) => (
    <div className="grid gap-10 py-4">
      {(Object.keys(variantNames) as Variant[]).map((variant) => (
        <Preview key={variant} reader={reader} variant={variant} />
      ))}
    </div>
  ),
};
