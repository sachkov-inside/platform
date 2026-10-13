import { useState, type SubmitEvent } from "react";
import { Check, Copy } from "lucide-react";
import { productTaskAgentPhrase } from "@/entities/product-task";
import { Button } from "@/shared/ui/button";
import { learnerMcpUrl } from "@/storybook/product-task.fixtures";
import { accepting, protocol, task } from "./snapshot";
import styles from "./unified-reading-prototype.module.css";

export type Scenario =
  "ready" | "history" | "unavailable" | "version" | "closed" | "expired";
export interface DemoSubmission {
  readonly note: string;
  readonly report: string;
  readonly repository: string;
  readonly reviewed: boolean;
  readonly version: number;
}
export const exampleSubmissions: readonly DemoSubmission[] = [
  {
    note: "Сохранил бриф и инструкции в проекте. Новая сессия нашла входные данные по указателям.",
    report:
      "Пример отчёта: критерии проверены агентом участника. Это самопроверка, не оценка автора.",
    repository: "https://github.com/example/learner-project",
    reviewed: false,
    version: task.version,
  },
  {
    note: "Настроил проект. В первой проверке агент не нашёл трекер; затем исправил указатель.",
    report: "",
    repository: "",
    reviewed: true,
    version: task.version,
  },
];
export function TaskSubmission({
  scenario,
  submissions,
  onSubmit,
  onRecover,
}: {
  readonly scenario: Scenario;
  readonly submissions: readonly DemoSubmission[];
  readonly onSubmit: (value: DemoSubmission) => void;
  readonly onRecover: () => void;
}) {
  const [note, setNote] = useState("");
  const [repository, setRepository] = useState("");
  const [report, setReport] = useState("");
  const [message, setMessage] = useState("");
  const [copy, setCopy] = useState("Копировать фразу");
  const phrase = productTaskAgentPhrase(task.code);
  const failure =
    scenario === "unavailable"
      ? "Не удалось отправить сдачу. Попробуй ещё раз."
      : scenario === "expired"
        ? "Сессия закончилась. Войди снова, заметка останется в форме."
        : scenario === "version"
          ? "Требования задания обновились, пока страница была открыта. Обнови страницу и проверь работу по новой версии."
          : undefined;
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (failure !== undefined) {
      setMessage(failure);
      return;
    }
    onSubmit({
      note,
      repository,
      report,
      reviewed: false,
      version: task.version,
    });
    setMessage("Сдача отправлена. Она появилась в «Моих сдачах».");
    setNote("");
    setRepository("");
    setReport("");
  }
  return (
    <>
      <section
        className={styles["submission"]}
        id="pilot-submit"
        aria-label="Сдать задание"
      >
        <p>
          Сдаёт твой агент: он проверит проект по критериям и отправит отчёт с
          твоего согласия.
        </p>
        {!accepting || scenario === "closed" ? (
          <p role="status" className={styles["notice"]}>
            Приём сдач скоро откроется. Агент уже может проверить проект, но
            отправить сдачу пока нельзя.
          </p>
        ) : null}
        <ol className={styles["submitSteps"]}>
          <li>
            <h3>Подключи учебный MCP к своему агенту</h3>
            <p>
              Один раз для всех заданий. Подходит Claude Code, Codex, OpenCode и
              другой агент с MCP по HTTP. Войди тем же аккаунтом, что и на
              сайте.
            </p>
            <p className={styles["address"]}>
              <code>{learnerMcpUrl}</code>
            </p>
            <a
              href="/practice-review-setup.txt"
              target="_blank"
              rel="noreferrer"
            >
              Инструкция подключения
            </a>
          </li>
          <li>
            <h3>Передай агенту эту фразу</h3>
            <div className={styles["phrase"]}>
              <p>{phrase}</p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(phrase)
                    .then(() => {
                      setCopy("Скопировано");
                    })
                    .catch(() => {
                      setCopy("Выдели и скопируй фразу вручную");
                    });
                }}
              >
                {copy === "Скопировано" ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
                <span role="status">{copy}</span>
              </Button>
            </div>
          </li>
          <li>
            <h3>Проверь отчёт и подтверди отправку</h3>
            <p>
              Агент прочитает задание и проект, ничего не меняя. Команду он
              запустит, только если ты разрешишь именно её. Перед отправкой
              агент покажет весь отчёт и поможет написать заметку в 5–7 строк.
            </p>
          </li>
        </ol>
        <details className={styles["disclosure"]}>
          <summary>Процедура проверки, которую получает агент</summary>
          <div>
            <p>
              Тот же текст отдаёт учебный MCP. Версия процедуры{" "}
              {protocol.version}.
            </p>
            <ol lang="en" className={styles["protocol"]}>
              {protocol.instructions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        </details>
        <details className={styles["disclosure"]} data-fallback-form>
          <summary>Нет агента с MCP? Сдать через форму</summary>
          <form onSubmit={submit} className={styles["form"]} data-demo-form>
            <p>
              Без агента отчёт проверки можно не прикладывать. Ветку и commit
              указывать не нужно.
            </p>
            <label>
              Репозиторий <small>— необязательно</small>
              <input
                name="repositoryUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={repository}
                maxLength={500}
                onChange={(e) => {
                  setRepository(e.target.value);
                }}
                placeholder="https://github.com/…"
              />
            </label>
            <label>
              Заметка для автора{" "}
              <small>
                5–7 строк: что сделано, какие решения принял, в чём не уверен.
              </small>
              <textarea
                name="note"
                required
                maxLength={1000}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </label>
            <label>
              Отчёт проверки <small>— необязательно, текстом</small>
              <textarea
                name="reportText"
                maxLength={20000}
                value={report}
                onChange={(e) => {
                  setReport(e.target.value);
                }}
              />
            </label>
            <p className={styles["demoNote"]}>
              Демонстрация: форма меняет только память этой страницы.
            </p>
            <Button
              type="submit"
              disabled={!accepting || scenario === "closed"}
            >
              Отправить сдачу
            </Button>
            <p
              role={
                failure !== undefined && message !== "" ? "alert" : "status"
              }
            >
              {message}
            </p>
            {message !== "" && failure !== undefined ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onRecover();
                  setMessage("");
                }}
              >
                {scenario === "version"
                  ? "Обновить демо задания"
                  : "Восстановить демо"}
              </Button>
            ) : null}
            {scenario === "version" ? (
              <p className={styles["demoNote"]}>
                В прототипе восстановление возвращает снимок версии{" "}
                {task.version}. В продукте нужна новая проверка требований перед
                повторной сдачей.
              </p>
            ) : null}
          </form>
        </details>
      </section>
      <section id="pilot-mine" className={styles["mine"]}>
        <h2>Мои сдачи</h2>
        {submissions.length === 0 ? (
          <p>
            Здесь появятся твои сдачи, комментарий автора и отметка «посмотрел
            автор». Сдавать можно сколько угодно раз: прежние сдачи остаются.
          </p>
        ) : (
          <ol>
            {submissions.map((item, index) => (
              <li key={index}>
                <h3>{index === 0 ? "Последняя сдача" : "Предыдущая сдача"}</h3>
                <p className={styles["historyMeta"]}>
                  Через форму · Версия требований {item.version} (текущая)
                </p>
                {item.repository === "" ? null : (
                  <p className={styles["historyMeta"]}>{item.repository}</p>
                )}
                <p>{item.note}</p>
                {item.reviewed ? (
                  <>
                    <p className={styles["reviewed"]}>Посмотрел автор</p>
                    <p>
                      Комментарий автора: проверь, что новая сессия обнаруживает
                      скиллы штатным способом.
                    </p>
                  </>
                ) : (
                  <p className={styles["historyMeta"]}>Автор ещё не смотрел.</p>
                )}
                {item.report === "" ? null : (
                  <details className={styles["disclosure"]}>
                    <summary>Мой отчёт</summary>
                    <p>{item.report}</p>
                  </details>
                )}
                <details className={styles["disclosure"]}>
                  <summary>Критерии версии {item.version} (текущей)</summary>
                  <ol>
                    {task.definition.criteria.map((criterion) => (
                      <li key={criterion.id}>{criterion.task}</li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
