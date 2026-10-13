import type { RenderedBlock } from "@/entities/material";
import { HarnessDiagram } from "./ui/harness-diagram";
import styles from "./ui/harness-diagram.module.css";

const guideHeadings = [
  "Зачем поручать настройку агенту",
  "Как подключить GitHub",
  "Бриф в проекте",
  "Скиллы Matt Pocock",
  "Трекер задач",
  "Файл инструкций",
  "Как проверить настройку",
  "Где пригодится",
];
const taskHeadings = [
  "Что нужно сделать",
  "1. Настрой, как агент с тобой разговаривает",
  "2. Создай репозиторий на GitHub и свяжи его с папкой проекта",
  "3. Положи в проект бриф заказчика",
  "4. Установи в проект скиллы Matt Pocock",
  "5. Настрой скиллы на задачи в GitHub Issues",
  "6. Опиши проект в AGENTS.md",
  "7. Проверь, что новая сессия находит всё сама",
  "Что решаешь сам",
  "Сдать",
  "Материалы к заданию",
];

/** Pinned published source, not a new authoring format. New versions retain ordinary Content rendering. */
export function projectHarnessIllustrations(
  id: string,
  version: number,
  blocks: readonly RenderedBlock[],
) {
  const guide = id === "inside-content-aie-ch1-project-setup";
  if ((!guide && id !== "aie-ch1-harness") || version !== 2) return undefined;
  const headings = blocks.flatMap((block) =>
    block.kind === "heading"
      ? [block.content.map((part) => part.text).join("")]
      : [],
  );
  const expected = guide ? guideHeadings : taskHeadings;
  if (
    headings.length !== expected.length ||
    headings.some((heading, index) => heading !== expected[index])
  )
    return undefined;
  const at = (heading: string) =>
    blocks.findIndex(
      (block) =>
        block.kind === "heading" &&
        block.content.map((part) => part.text).join("") === heading,
    );
  const figure = (focus: "overview" | "brief" | "skills") => (
    <div className={styles["canvas"]}>
      <HarnessDiagram focus={focus} taskOverview={!guide} />
    </div>
  );
  return {
    illustrations: [
      { after: 0, node: figure("overview") },
      {
        after:
          at(guide ? "Бриф в проекте" : taskHeadings[3]!) + (guide ? 3 : 1),
        node: figure("brief"),
      },
      {
        after:
          at(guide ? "Скиллы Matt Pocock" : taskHeadings[4]!) +
          (guide ? 10 : 1),
        node: figure("skills"),
      },
    ],
    // This recognized guide has one source overview; its code-native equivalent now precedes the components.
    replacesOverview:
      guide && blocks.filter((block) => block.kind === "image").length === 1,
  };
}

export { HarnessDiagram } from "./ui/harness-diagram";
