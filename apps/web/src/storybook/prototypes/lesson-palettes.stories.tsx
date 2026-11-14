import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { z } from "zod";

import {
  exerciseFingerprint,
  materialExercises,
  type RenderedBlock,
  type RenderedText,
} from "@inside/material-blocks";
import { MaterialReaderView } from "@/_pages/material-reader/ui/material-reader-view";
import type {
  HighlightedCode,
  MaterialCodeHighlights,
} from "@/entities/material/model/code-highlight";
import { highlightMaterialCode } from "@/entities/material/model/highlight-material-code";
import {
  LessonExerciseAttempts,
  lessonExercises,
  SavedLessonExerciseSummary,
} from "@/features/exercise-attempts";
import { SavedLessonRating } from "@/features/lesson-rating";
import { LessonTermDeck } from "@/features/lesson-term-deck";
import { ReadingProgressProvider } from "@/features/reading-progress";
import { getQueryClient } from "@/shared/api/query-client";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { accountPresentationResponse } from "@/storybook/account.fixtures";
import { variantDiagram } from "@/storybook/image-variants";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { svgFigurePair } from "@/storybook/svg-figures";

import "./lesson-palettes.css";

/*
 * Prototype for #2118: three palettes of the lesson «витрина» for the owner's choice. The page is
 * the real production reader (MaterialReaderView with the lesson-end fixtures); each variant only
 * wraps it in a class that redefines the lesson tokens of globals.css. A chosen palette moves into
 * globals.css as these same token values. No production module imports this file.
 */

type PaletteId = "a" | "b" | "c";

interface Swatch {
  readonly name: string;
  readonly value: string;
}

interface Palette {
  readonly id: PaletteId;
  readonly name: string;
  readonly rationale: string;
  readonly swatches: readonly Swatch[];
}

const palettes: Record<PaletteId, Palette> = {
  a: {
    id: "a",
    name: "A · Графит",
    rationale:
      "Холодный серый вместо песка, графитовый текст и кнопки. Оранжевый сайта остался только у ссылок и фокуса.",
    swatches: [
      { name: "Подложка блоков", value: "#f2f3f5" },
      { name: "Определение", value: "#e9ebef" },
      { name: "Линии", value: "#dfe2e7" },
      { name: "Графит", value: "#1f2125" },
      { name: "Подписи", value: "#565b63" },
      { name: "Код", value: "#1c1e22" },
      { name: "Ссылка", value: "#b83a1d" },
    ],
  },
  b: {
    id: "b",
    name: "B · Тёмные блоки",
    rationale:
      "Страница белая, всё, с чем ученик действует, лежит на тёмных графитовых карточках. Врезки на светлом нейтральном сером.",
    swatches: [
      { name: "Тёмный блок", value: "#1d1f23" },
      { name: "Карточка в блоке", value: "#2b2e34" },
      { name: "Текст в блоке", value: "#f1f2f4" },
      { name: "Подписи в блоке", value: "#a9aeb6" },
      { name: "Врезки", value: "#f2f3f5" },
      { name: "Определение", value: "#eaecf0" },
      { name: "Ссылка", value: "#b83a1d" },
    ],
  },
  c: {
    id: "c",
    name: "C · Контраст",
    rationale:
      "Белая страница без заливок: блоки отделены тонкой графитовой рамкой, текст плотный графитовый. Цвет только у верно и неверно.",
    swatches: [
      { name: "Фон и блоки", value: "#ffffff" },
      { name: "Рамка", value: "#2f3237" },
      { name: "Тихая заливка", value: "#f4f5f6" },
      { name: "Текст", value: "#17181b" },
      { name: "Подписи", value: "#4b4f56" },
      { name: "Верно", value: "#2f7a43" },
      { name: "Неверно", value: "#b3261e" },
    ],
  },
};

/* ------------------------------------------------------------------ the showcase lesson */

const materialId = "02000000-0000-4000-8000-000000000010";
const accountId = "20000000-0000-4000-8000-000000002118";

const t = (text: string): RenderedText => ({ kind: "text", text, marks: [] });
const paragraph = (...content: RenderedText[]): RenderedBlock => ({
  kind: "paragraph",
  content,
});
const p = (text: string): RenderedBlock => paragraph(t(text));
const heading = (level: 2 | 3 | 4, text: string): RenderedBlock => ({
  kind: "heading",
  level,
  content: [t(text)],
});
const callout = (
  tone: Extract<RenderedBlock, { kind: "callout" }>["tone"],
  title: string | undefined,
  text: string,
  collapse?: "collapsed",
): RenderedBlock => ({
  kind: "callout",
  tone,
  ...(title === undefined ? {} : { title }),
  ...(collapse === undefined ? {} : { collapse }),
  content: [p(text)],
});

const terms = [
  {
    id: "observable-behaviour",
    title: "Наблюдаемое поведение",
    englishTitle: "Observable behaviour",
    shortDefinition: "То, что пользователь или другая система видят снаружи.",
    fullDefinition:
      "Всё, что система показывает наружу: ответ на запрос, запись в базе, письмо пользователю.\n\nВнутреннее устройство сюда не входит, поэтому проверка по наблюдаемому поведению переживает рефакторинг.",
  },
  {
    id: "acceptance-criterion",
    title: "Приёмочный критерий",
    englishTitle: "Acceptance criterion",
    shortDefinition:
      "Проверяемое условие, при котором задачу считают сделанной.",
    fullDefinition:
      "Проверяемое условие, при котором задачу считают сделанной. Его формулируют до начала работы.",
  },
  {
    id: "regression",
    title: "Регрессия",
    englishTitle: "Regression",
    shortDefinition:
      "Поломка того, что раньше работало, после нового изменения.",
    fullDefinition:
      "Поломка того, что раньше работало, после нового изменения.",
  },
] as const;

const code = [
  "// Проверяем то, что видит пользователь",
  'test("новая запись появляется в списке", async () => {',
  '  await page.getByRole("button", { name: "Добавить" }).click();',
  '  await expect(page.getByText("Купить молоко")).toBeVisible();',
  "});",
].join("\n");

const body: RenderedBlock[] = [
  p(
    "Агент закончил задачу, тесты зелёные. Значит ли это, что результат готов? Этот урок разбирает, как проверить работу по тому, что видит пользователь.",
  ),
  heading(2, "Что считать результатом"),
  paragraph(
    t("Результат задачи описывают через "),
    {
      kind: "text",
      text: "наблюдаемое поведение",
      marks: [{ kind: "link", href: "term:observable-behaviour" }],
    },
    t(". Это "),
    { kind: "text", text: "не код", marks: [{ kind: "bold" }] },
    t(" и "),
    { kind: "text", text: "не список файлов", marks: [{ kind: "italic" }] },
    t(", а то, что пользователь видит после действия. Команда "),
    { kind: "text", text: "pnpm test", marks: [{ kind: "code" }] },
    t(" подтверждает только то, что проверки написаны. Подробнее в "),
    {
      kind: "text",
      text: "руководстве по приёмке",
      marks: [{ kind: "link", href: "https://example.com/docs" }],
    },
    t("."),
  ),
  { kind: "term_definition", termId: "observable-behaviour" },
  heading(3, "Три признака хорошего критерия"),
  {
    kind: "bullet_list",
    items: [
      [p("Его можно проверить снаружи, не открывая код.")],
      [p("Его сформулировали до начала работы.")],
      [p("Он описывает одно поведение, а не сразу несколько.")],
    ],
  },
  {
    kind: "ordered_list",
    items: [
      [p("Опиши, что пользователь делает.")],
      [p("Опиши, что он видит в ответ.")],
      [p("Проверь это руками или тестом.")],
    ],
  },
  {
    kind: "blockquote",
    content: [
      p(
        "Тест, который знает, как устроен код, ломается при каждом рефакторинге и молчит при настоящей ошибке.",
      ),
    ],
  },
  callout(
    "tip",
    undefined,
    "Начни с одного критерия и проверь его до того, как добавлять следующий.",
  ),
  callout(
    "note",
    undefined,
    "Критерий пишут словами пользователя: «видит», «получает», «может».",
  ),
  callout(
    "warning",
    undefined,
    "Зелёные тесты агента не доказывают, что задача решена: агент мог проверить не то.",
  ),
  callout(
    "example",
    "Критерий для списка покупок",
    "После нажатия «Добавить» новая строка появляется вверху списка.",
  ),
  callout("good", undefined, "«Пользователь видит новую запись в списке»."),
  callout("bad", undefined, "«Функция вызывает метод репозитория»."),
  callout(
    "definition",
    "Регрессия",
    "Поломка того, что раньше работало, после нового изменения.",
  ),
  callout(
    "task",
    "Попробуй сам",
    "Перепиши критерий своей последней задачи так, чтобы его можно было проверить снаружи.",
  ),
  callout(
    "tip",
    "Почему не проверять внутренние вызовы",
    "Внутренние вызовы меняются при каждом рефакторинге, а поведение остаётся.",
    "collapsed",
  ),
  heading(2, "Как проверять"),
  {
    kind: "table",
    rows: [
      {
        cells: [
          { header: true, content: [p("Проверка")] },
          { header: true, content: [p("Что видит")] },
          { header: true, content: [p("Когда ломается")] },
        ],
      },
      {
        cells: [
          { header: false, content: [p("По поведению")] },
          { header: false, content: [p("Экран и ответы")] },
          { header: false, content: [p("Когда сломан результат")] },
        ],
      },
      {
        cells: [
          { header: false, content: [p("По устройству")] },
          { header: false, content: [p("Вызовы функций")] },
          { header: false, content: [p("При любом рефакторинге")] },
        ],
      },
    ],
  },
  { kind: "code_block", language: "typescript", text: code },
  variantDiagram,
  svgFigurePair,
  { kind: "step_break", label: "А как понять, что я усвоил?" },
  heading(2, "Проверь себя"),
  {
    kind: "quiz",
    id: "observable-result",
    reveal: "none",
    question: [p("Что лучше проверяет результат задачи?")],
    selectionMode: "single",
    options: [
      {
        id: "visible",
        content: [p("Пользователь видит новую запись в списке.")],
        correct: true,
        explanation: [p("Верно. Это видно снаружи.")],
      },
      {
        id: "repository",
        content: [p("Функция вызывает нужный метод репозитория.")],
        correct: false,
        explanation: [p("Это устройство кода, а не результат.")],
      },
      {
        id: "stack",
        content: [p("Код написан на TypeScript.")],
        correct: false,
        explanation: [p("Это выбор инструмента.")],
      },
    ],
  },
  {
    kind: "match",
    id: "check-kinds",
    reveal: "none",
    question: [p("Сопоставь проверку и то, что она видит.")],
    mode: "pairs",
    rows: [
      ["behaviour", "Тест по поведению", "screen"],
      ["structure", "Тест по устройству", "calls"],
      ["manual", "Ручная проверка", "eyes"],
    ].map(([id = "", value = "", answerId = ""]) => ({
      id,
      content: [p(value)],
      answerId,
      explanation: [p(`Пояснение: ${value}.`)],
    })),
    choices: [
      { id: "screen", content: [p("Экран и ответы")] },
      { id: "calls", content: [p("Вызовы функций")] },
      { id: "eyes", content: [p("Глазами человека")] },
    ],
  },
  {
    kind: "order",
    id: "criterion-steps",
    reveal: "none",
    question: [p("Расставь шаги по порядку.")],
    steps: [
      ["action", "Описать действие пользователя"],
      ["outcome", "Описать, что он видит"],
      ["verify", "Проверить руками или тестом"],
    ].map(([id = "", value = ""]) => ({
      id,
      content: [p(value)],
      explanation: [p(`Шаг «${value}».`)],
    })),
  },
  p("Готово: теперь у задачи есть критерий, который переживёт рефакторинг."),
];

/** Every exercise already answered correctly, as a returning reader sees them. */
const answered = materialExercises(body).map((exercise) => ({
  exerciseId: exercise.id,
  fingerprint: exerciseFingerprint(exercise),
  answer:
    exercise.kind === "quiz"
      ? {
          kind: "options",
          optionIds: exercise.options
            .filter((option) => option.correct)
            .map((option) => option.id),
        }
      : exercise.kind === "match"
        ? {
            kind: "matches",
            matches: exercise.rows.map((row) => ({
              rowId: row.id,
              choiceId: row.answerId,
            })),
          }
        : { kind: "sequence", stepIds: exercise.steps.map((step) => step.id) },
  result: "correct",
  firstForVersion: true,
  attemptedAt: "2026-11-13T09:00:00.000Z",
}));

const requestPath = (input: RequestInfo | URL) =>
  new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  ).pathname;

const requestBody = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw =
    input instanceof Request ? await input.clone().text() : init?.body;
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(typeof raw === "string" ? raw : "{}"));
};

/** The highlighting the loader computed, as the server would for a page. */
function codeHighlightsOf(
  loaded: Readonly<Record<string, unknown>>,
): MaterialCodeHighlights | undefined {
  const value = loaded["codeHighlights"];
  if (!(value instanceof Map)) return undefined;
  const highlights = new Map<string, HighlightedCode>();
  for (const [key, highlighted] of value.entries())
    if (typeof key === "string") highlights.set(key, highlighted);
  return highlights;
}

/* ------------------------------------------------------------------ the variant page */

function PaletteHeader({ palette }: { readonly palette: Palette }) {
  return (
    <section
      aria-label="Вариант палитры"
      className="lesson-palette-header mx-auto mb-8 max-w-[43rem] rounded-2xl border border-border p-4 sm:p-5"
    >
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Прототип палитры урока
      </p>
      <h2 className="mt-1 text-xl font-semibold">{palette.name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{palette.rationale}</p>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {palette.swatches.map((swatch) => (
          <li className="flex min-w-0 items-center gap-2" key={swatch.name}>
            <span
              aria-hidden="true"
              className="size-7 shrink-0 rounded-md ring-1 ring-black/15"
              style={{ background: swatch.value }}
            />
            <span className="min-w-0 text-xs leading-tight">
              <span className="block truncate">{swatch.name}</span>
              <span className="font-mono text-muted-foreground">
                {swatch.value}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">
          Кнопка шага до нажатия (классы LessonGateControl):
        </span>
        <button
          className="min-h-11 max-w-[90%] rounded-full bg-lesson-graphite px-5 py-2.5 text-center font-medium text-lesson-graphite-foreground shadow-sm hover:bg-lesson-graphite-hover"
          type="button"
        >
          А как понять, что я усвоил?
        </button>
      </div>
    </section>
  );
}

function ReaderIdentity({ children }: { readonly children: ReactNode }) {
  return (
    <ReadingProgressProvider accountId={accountId} resolved>
      {children}
    </ReadingProgressProvider>
  );
}

const programme = productProgrammeHref("ai-engineering");

const environment = publicPageEnvironment("/materials/showcase", {
  account: "authenticated",
});

interface PaletteStoryArgs {
  readonly palette: PaletteId;
}

const meta = {
  ...environment,
  title: "Prototypes/Lesson Palettes",
  tags: ["!autodocs"],
  args: { palette: "a" },
  argTypes: { palette: { control: "inline-radio", options: ["a", "b", "c"] } },
  parameters: { ...environment.parameters, a11y: { test: "todo" } },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    const original = window.fetch.bind(window);
    return fetchBeforeRender(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/account") return accountPresentationResponse();
      if (path === "/api/reading-progress/states") {
        const { materialIds } = z
          .object({ materialIds: z.array(z.string()) })
          .parse(await requestBody(input, init));
        return Response.json({
          kind: "ready",
          states: materialIds.map((id) => ({
            materialId: id,
            isRead: false,
            version: 1,
            readAt: null,
            updatedAt: null,
            updateNote: null,
            // Both parts are open: the step break shows the reader's reply.
            openedParts: 2,
          })),
        });
      }
      if (path === "/api/lesson-ratings/query")
        return Response.json({ kind: "ready", rating: "like" });
      if (path === "/api/exercise-attempts/query")
        return Response.json({ kind: "ready", attempts: answered });
      if (path.startsWith("/api/materials/")) return original(input, init);
      if (path.startsWith("/api/"))
        return Response.json({ kind: "unavailable" }, { status: 503 });
      return original(input, init);
    })();
  },
  decorators: [
    (Story) => (
      <ReaderIdentity>
        <Story />
      </ReaderIdentity>
    ),
    ...environment.decorators,
  ],
  loaders: [
    async () => ({ codeHighlights: await highlightMaterialCode(body) }),
  ],
  render: ({ palette }, { loaded }) => (
    <div className={`lesson-palette lesson-palette-${palette}`}>
      <PaletteHeader palette={palettes[palette]} />
      <MaterialReaderView
        body={body}
        codeHighlights={codeHighlightsOf(loaded)}
        exerciseScope={(lesson) => (
          <LessonExerciseAttempts
            exercises={lessonExercises(body)}
            materialId={materialId}
            signInHref="/account"
          >
            {lesson}
          </LessonExerciseAttempts>
        )}
        exerciseSummary={<SavedLessonExerciseSummary />}
        glossaryTerms={terms}
        lessonRating={<SavedLessonRating materialId={materialId} />}
        material={{
          materialId,
          contentVersion: 1,
          access: "free",
          cover: null,
          format: { name: "Гайд", slug: "guide" },
          difficulty: "basic",
          outcomes: [],
          publishedAt: "2026-11-13T09:00:00.000Z",
          productMemberships: [],
          slug: "showcase",
          summary: "Витрина всех блоков урока.",
          tags: [],
          title: "Результат и его проверка",
          topic: {
            name: "AI-first engineering",
            slug: "ai-first-engineering",
          },
        }}
        primaryVideo={null}
        productContext={{
          currentPosition: 2,
          totalMaterials: 3,
          product: { name: "AI Engineering", href: programme },
          previous: {
            title: "Первый урок",
            href: materialReaderHref("first", programme),
          },
          next: {
            title: "Следующий урок",
            href: materialReaderHref("next", programme),
          },
        }}
        termDeck={<LessonTermDeck terms={terms} />}
      />
    </div>
  ),
} satisfies Meta<PaletteStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

export const PaletteA: Story = { args: { palette: "a" } };
export const PaletteB: Story = { args: { palette: "b" } };
export const PaletteC: Story = { args: { palette: "c" } };
export const PaletteAMobile: Story = { args: { palette: "a" }, ...mobile };
export const PaletteBMobile: Story = { args: { palette: "b" }, ...mobile };
export const PaletteCMobile: Story = { args: { palette: "c" }, ...mobile };
