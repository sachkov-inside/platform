import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  Circle,
  Share2,
} from "lucide-react";
import { MaterialBodyView } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  ReaderFrame,
  MaterialReaderHeader,
} from "@/_pages/material-reader/ui/material-reader-view";
import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { publicPageEnvironment } from "./story-environment";
import { courseGuide } from "./course-reading.fixtures";
import { fetchBeforeRender } from "./mutation-mock";
import { accountPresentationResponse, respondByPath } from "./account.fixtures";
import { getQueryClient } from "@/shared/api/query-client";
import styles from "./reader-actions-experiment.module.css";

// Throwaway #1591 proof. Both alternatives use the unchanged production Reader frame.
const material = {
  materialId: "reader-actions-prototype",
  contentVersion: 1,
  access: "free",
  cover: null,
  format: { name: "Гайд", slug: "guide" },
  difficulty: "basic",
  outcomes: [],
  publishedAt: "2026-10-20T08:00:00.000Z",
  seriesMemberships: [],
  slug: "course-intro",
  title: "Как устроен курс",
  summary: "Путь обучения и задания курса.",
  tags: [],
  topic: { name: "AI-агенты", slug: "ai-agents" },
} as const satisfies MaterialReaderMetadata;
const body: ReaderBlock[] = Array.from({ length: 16 }, () => ({
  kind: "paragraph",
  content: [
    {
      kind: "text",
      marks: [],
      text: "Проходи материалы в порядке программы. Верхняя строка помогает перейти к следующему уроку, сохранить закладку или отметить изученное.",
    },
  ],
}));
const context = {
  currentPosition: 2,
  totalMaterials: 3,
  previous: courseGuide.previous,
  next: courseGuide.next,
  series: {
    name: courseGuide.name,
    href: courseGuide.href,
    hasModeVariants: false,
  },
  programme: courseGuide,
};
const target = parseMaterialReaderReturnTarget(courseGuide.href);

function ReaderActionsExperiment({
  initialVariant = "labels",
}: {
  initialVariant?: "labels" | "compact";
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [saved, setSaved] = useState(false);
  const [studied, setStudied] = useState(false);
  const [hasNext, setHasNext] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [feedbackPosition, setFeedbackPosition] = useState<"top" | "bottom">(
    "top",
  );
  const [shareCount, setShareCount] = useState(0);
  const toolbar = (position: "top" | "bottom") => (
    <div className={styles["slot"]}>
      <nav
        aria-label={
          position === "top"
            ? "Действия материала"
            : "Действия в конце материала"
        }
        className={styles["panel"]}
        data-prototype-actions={position}
        data-variant={variant}
      >
        <div className={styles["left"]}>
          <Button
            variant="ghost"
            className={styles["action"]}
            aria-label="Назад"
            title="Вернуться к программе (демо)"
            onClick={() => {
              setFeedbackPosition(position);
              setFeedback(
                "Демо: возврат к программе курса. Страница остаётся открытой для сравнения.",
              );
            }}
          >
            <ArrowLeft aria-hidden="true" />
            <span className={styles["navigationLabel"]}>Назад</span>
          </Button>
          <Button
            variant="ghost"
            className={styles["action"]}
            aria-label={saved ? "Сохранено" : "Сохранить"}
            title={saved ? "Убрать из сохранённого" : "Сохранить"}
            aria-pressed={saved}
            onClick={() => {
              setSaved((value) => !value);
            }}
          >
            <Bookmark
              aria-hidden="true"
              fill={saved ? "currentColor" : "none"}
            />
            <span className={styles["secondaryLabel"]}>
              {saved ? "Сохранено" : "Сохранить"}
            </span>
          </Button>
          <Button
            variant="ghost"
            className={styles["action"]}
            aria-label="Изучено"
            title={studied ? "Снять отметку изучения" : "Отметить изученным"}
            aria-pressed={studied}
            onClick={() => {
              setStudied((value) => !value);
            }}
          >
            {studied ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <Circle aria-hidden="true" />
            )}
            <span className={styles["studyLabel"]}>Изучено</span>
          </Button>
          <Button
            variant="ghost"
            className={styles["action"]}
            aria-label="Поделиться"
            title="Поделиться (демо)"
            onClick={() => {
              setShareCount((value) => value + 1);
              setFeedbackPosition(position);
              setFeedback(
                "Демо: ссылка скопирована. Буфер обмена и системное меню не изменяются.",
              );
            }}
          >
            <Share2 aria-hidden="true" />
            <span className={styles["secondaryLabel"]}>Поделиться</span>
          </Button>
        </div>
        {hasNext ? (
          <Button
            className={cn(styles["action"], styles["next"])}
            aria-label="Дальше"
            title="Следующий урок (демо)"
            onClick={() => {
              setFeedbackPosition(position);
              setFeedback(
                "Демо: переход к следующему уроку. Страница остаётся открытой для сравнения.",
              );
            }}
          >
            <span className={styles["navigationLabel"]}>Дальше</span>
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
      </nav>
      {feedbackPosition === position && feedback !== "" ? (
        <p role="status" className={styles["feedback"]}>
          {feedback}
        </p>
      ) : null}
    </div>
  );
  return (
    <div className={styles["experiment"]}>
      <aside aria-label="Управление прототипом" className={styles["controls"]}>
        <strong>Эксперимент Reader · #1591</strong>
        <div className={styles["choices"]}>
          <Button
            variant="outline"
            aria-pressed={variant === "labels"}
            onClick={() => {
              setVariant("labels");
            }}
          >
            A · Подписи
          </Button>
          <Button
            variant="outline"
            aria-pressed={variant === "compact"}
            onClick={() => {
              setVariant("compact");
            }}
          >
            B · Компактно
          </Button>
          <label>
            <input
              type="checkbox"
              checked={hasNext}
              onChange={(event) => {
                setHasNext(event.target.checked);
              }}
            />{" "}
            Есть следующий шаг
          </label>
        </div>
        <p>
          Только пример. Состояния сбрасываются при перезагрузке. Текст ниже,
          учебная fixture для проверки длинной страницы.
        </p>
        <output data-prototype-state>
          Сохранено: {saved ? "да" : "нет"}. Изучено: {studied ? "да" : "нет"}.
          Поделиться: {shareCount}.
        </output>
        <p>Попробуйте действия в начале и в конце материала.</p>
      </aside>
      <ReaderFrame
        context={context}
        target={target}
        hideReturn
        repeatAtBottom={false}
      >
        <div className="mx-auto min-w-0 max-w-[43rem]">
          {toolbar("top")}
          <div className={styles["heading"]}>
            <MaterialReaderHeader material={material} programme={courseGuide} />
          </div>
          <article
            className="mt-8 min-w-0 break-words text-pretty text-[0.9375rem] leading-[1.65] text-foreground sm:text-base xl:text-lg"
            data-reader-body
          >
            <MaterialBodyView
              blocks={body}
              path={[]}
              rendering={{
                image: () => null,
                file: () => null,
                headingId: (path) => `prototype-section-${path.join("-")}`,
              }}
            />
          </article>
          <div className="mt-5">{toolbar("bottom")}</div>
        </div>
      </ReaderFrame>
    </div>
  );
}
const environment = publicPageEnvironment("/materials/course-intro", {
  account: "authenticated",
});
const meta = {
  ...environment,
  title: "Prototypes/1591 Reader actions",
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    return fetchBeforeRender(
      respondByPath({ "/api/account": () => accountPresentationResponse() }),
    )();
  },
  component: ReaderActionsExperiment,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Two close fixture-only alternatives. No production writes. Owner selection pending.",
      },
    },
  },
} satisfies Meta<typeof ReaderActionsExperiment>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ALabels: Story = { args: { initialVariant: "labels" } };
export const BCompact: Story = { args: { initialVariant: "compact" } };
