import { useId } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./unified-reading-prototype.module.css";

type Focus = "overview" | "brief" | "skills" | "lookup";
function Relation({
  label,
  sideways = false,
}: {
  readonly label: string;
  readonly sideways?: boolean;
}) {
  return (
    <div
      className={cn(styles["relation"], sideways && styles["sideways"])}
      aria-hidden="true"
    >
      <span>{label}</span>
      <svg viewBox="0 0 24 40" width="24" height="40">
        <path d="M12 1v35m-5-5 5 5 5-5" />
      </svg>
    </div>
  );
}
export function HarnessDiagram({
  focus = "overview",
  taskOverview = false,
}: {
  readonly focus?: Focus;
  readonly taskOverview?: boolean;
}) {
  const id = useId();
  const captions = {
    overview:
      "Результат настройки: новая сессия находит входные данные проекта.",
    brief: "AGENTS.md указывает на бриф. Сам бриф хранится отдельным файлом.",
    skills: "Один набор в проекте. Источник и коммит записаны в проекте.",
    lookup: "Новая сессия стартует в папке проекта и проходит по указателям.",
  };
  return (
    <figure
      className={styles["diagram"]}
      data-focus={focus}
      aria-labelledby={id}
    >
      <div className={styles["diagramTop"]}>
        <div className={styles["diagramNode"]} data-subject="personal">
          <strong>Личные инструкции</strong>
          <span>Вне репозитория · язык и стиль</span>
          {taskOverview ? <small>Проверяются локально</small> : null}
        </div>
        <Relation label="задают стиль" sideways />
        <div className={styles["diagramNode"]} data-subject="lookup">
          <strong>Новая сессия</strong>
          <span>Запуск в папке проекта</span>
        </div>
      </div>
      <Relation label="сессия читает AGENTS.md" />
      <div className={styles["projectBoundary"]}>
        <p className={styles["boundaryLabel"]}>Файлы проекта</p>
        <div className={styles["diagramNode"]} data-subject="lookup">
          <strong>AGENTS.md</strong>
          <span>Что за проект · кто решает · указатели</span>
        </div>
        <Relation label="указывает, где искать" />
        <div className={styles["diagramInputs"]}>
          <div className={styles["diagramNode"]} data-subject="brief">
            <strong>Бриф</strong>
            <span>Требования заказчика</span>
          </div>
          <div className={styles["diagramNode"]} data-subject="skills">
            <strong>.agents/skills</strong>
            <span>Копия набора</span>
            <small>Источник + коммит</small>
          </div>
          <div className={styles["diagramNode"]} data-subject="tracker">
            <strong>Настройка трекера</strong>
            <span>Адрес Issues и пометки</span>
          </div>
        </div>
        {focus === "skills" ? (
          <p className={styles["diagramNote"]}>
            Если агент читает свою папку, она ссылается на общий набор. На
            Windows допустима копия.
          </p>
        ) : null}
        {focus === "lookup" || taskOverview ? (
          <p className={styles["diagramNote"]}>
            Сессия находит бриф и трекер по указателям. Скиллы доступны в
            штатном списке агента.
          </p>
        ) : null}
      </div>
      <div className={styles["githubRelations"]}>
        <Relation label="файлы: commit и push" />
        <Relation label="настройка указывает адрес" />
      </div>
      <div className={styles["githubBoundary"]}>
        <p className={styles["boundaryLabel"]}>GitHub</p>
        <div className={styles["githubNodes"]}>
          <div className={styles["diagramNode"]}>
            <strong>origin/main</strong>
            <span>Файлы проекта на GitHub</span>
          </div>
          <div className={styles["diagramNode"]}>
            <strong>Issues и labels</strong>
            <span>Задачи и пометки</span>
          </div>
        </div>
      </div>
      <figcaption id={id}>{captions[focus]}</figcaption>
      <p className="sr-only">
        Личные инструкции находятся вне репозитория и проверяются локально.
        Новая сессия запускается в папке проекта и читает AGENTS.md. AGENTS.md
        содержит указатели на отдельный бриф, общий набор скиллов с источником и
        коммитом и настройку трекера. Файлы проекта отправляются в origin/main
        на GitHub. Настройка трекера указывает на Issues и labels в GitHub.
        Скиллы проверяются через штатное обнаружение выбранного агента.
      </p>
    </figure>
  );
}
