"use client";

/**
 * Throwaway proof: three list compositions and a separate submission page, inside the existing
 * authoring shell. ?variant=A|B|C selects the list; ?submission=<fixture id> opens an attempt.
 * All people, reports and contact handles below are synthetic. Nothing is sent or persisted.
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { Button } from "@/shared/ui/button";

import "./submissions-minimal.css";

type Outcome = "passed" | "changes" | "missing" | "none";
type Variant = "A" | "B" | "C";
interface Attempt {
  id: string;
  person: string;
  name: string;
  username: string | null;
  task: string;
  chapter: string;
  attempt: number | null;
  date: string;
  day: string;
  outcome: Outcome;
  summary: string;
  note: string;
}

const outcomes: Record<Outcome, string> = {
  passed: "Самопроверка пройдена",
  changes: "Нужны исправления",
  missing: "Не хватает подтверждений",
  none: "Без самопроверки",
};
const variants: { key: Variant; name: string }[] = [
  { key: "A", name: "Список" },
  { key: "B", name: "Таблица" },
  { key: "C", name: "По датам" },
];

const attempts: Attempt[] = [
  {
    id: "anna-3",
    person: "anna",
    name: "Анна Смирнова",
    username: "anna_example",
    task: "Онбординг команды",
    chapter: "Глава 1. Онбординг",
    attempt: 3,
    day: "Сегодня",
    date: "11 октября, 14:40",
    outcome: "passed",
    summary:
      "Доступ выдаёт только руководитель команды. Повторный запрос не создаёт вторую выдачу. Все обязательные критерии подтверждены.",
    note: "Проверку роли перенесла на сервер. Добавила тесты на чужую роль и повторный запрос. Выдачу доступа оставила отдельным модулем.",
  },
  {
    id: "ilya-1",
    person: "ilya",
    name: "Илья Громов",
    username: "ilya_example",
    task: "Заявки клиентов",
    chapter: "Глава 2. Работа с клиентами",
    attempt: 1,
    day: "Сегодня",
    date: "11 октября, 12:25",
    outcome: "changes",
    summary:
      "Повторная отправка создаёт вторую заявку. Сохраните один результат для одного запроса и проверьте повторную отправку.",
    note: "Создание заявки работает. Пока не уверен, где лучше хранить ключ повторного запроса.",
  },
  {
    id: "mark-1",
    person: "mark",
    name: "Марк Белов",
    username: null,
    task: "Заявки клиентов",
    chapter: "Глава 2. Работа с клиентами",
    attempt: null,
    day: "Вчера",
    date: "10 октября, 20:10",
    outcome: "none",
    summary: "Ученик отправил работу через форму. Отчёта агента нет.",
    note: "Отправляю текущий результат. Самопроверку с агентом ещё не выполнил.",
  },
  {
    id: "anna-2",
    person: "anna",
    name: "Анна Смирнова",
    username: "anna_example",
    task: "Онбординг команды",
    chapter: "Глава 1. Онбординг",
    attempt: 2,
    day: "Вчера",
    date: "10 октября, 18:30",
    outcome: "missing",
    summary:
      "Проверка роли появилась на сервере. Не хватает результата теста: обычный участник не должен получить доступ к выдаче.",
    note: "Исправила проверку роли. Тест для обычного участника пока не запускала.",
  },
  {
    id: "anna-1",
    person: "anna",
    name: "Анна Смирнова",
    username: "anna_example",
    task: "Онбординг команды",
    chapter: "Глава 1. Онбординг",
    attempt: 1,
    day: "9 октября",
    date: "9 октября, 15:45",
    outcome: "changes",
    summary:
      "Сервер доверяет роли из запроса. Пользователь может представиться руководителем и выдать доступ. Проверяйте роль по серверным данным.",
    note: "Сделала выдачу доступа через бота. Роль пока приходит из интерфейса.",
  },
];

function address(variant: Variant, submission: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", variant);
  if (submission === null) url.searchParams.delete("submission");
  else url.searchParams.set("submission", submission);
  return url;
}

function OutcomeLabel({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`submission-outcome outcome-${outcome}`}>
      {outcome === "passed" ? <Check aria-hidden="true" size={15} /> : null}
      {outcomes[outcome]}
    </span>
  );
}

export function SubmissionsMinimalPrototype({
  initialSubmission = null,
  initialVariant = "A",
  showVariants = false,
  expanded = false,
}: {
  initialSubmission?: string | null;
  initialVariant?: Variant;
  showVariants?: boolean;
  expanded?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [selected, setSelected] = useState<string | null>(initialSubmission);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  useEffect(() => {
    function readAddress() {
      const parameters = new URL(window.location.href).searchParams;
      const chosen = parameters.get("variant");
      if (chosen === "A" || chosen === "B" || chosen === "C")
        setVariant(chosen);
      else setVariant(initialVariant);
      const id = parameters.get("submission");
      if (id !== null && attempts.some((item) => item.id === id))
        setSelected(id);
      else setSelected(parameters.has("variant") ? null : initialSubmission);
    }
    readAddress();
    function backOrForward() {
      focusHeading.current = true;
      readAddress();
    }
    window.addEventListener("popstate", backOrForward);
    return () => {
      window.removeEventListener("popstate", backOrForward);
    };
  }, [initialSubmission, initialVariant]);

  useEffect(() => {
    if (focusHeading.current) {
      heading.current?.focus();
      focusHeading.current = false;
    }
  }, [selected, variant]);

  function navigate(next: string | null, nextVariant = variant) {
    focusHeading.current = true;
    window.history.pushState({}, "", address(nextVariant, next));
    setSelected(next);
    setVariant(nextVariant);
    setNotice("");
    document.getElementById("authoring-content")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function open(event: MouseEvent<HTMLAnchorElement>, id: string | null) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(id);
  }

  function cycle(step: number) {
    const index = variants.findIndex((item) => item.key === variant);
    const next = variants[(index + step + variants.length) % variants.length];
    if (next !== undefined) navigate(selected, next.key);
  }

  useEffect(() => {
    if (!showVariants) return;
    function keyboard(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input, textarea, select, [contenteditable=true], summary",
        )
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        cycle(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycle(-1);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("keydown", keyboard);
    };
  });

  const active = attempts.find((item) => item.id === selected);
  const filtered = attempts.filter(
    (item) =>
      (status === "all" || status === item.outcome) &&
      `${item.name} ${item.username ?? ""} ${item.task}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const history =
    active === undefined
      ? []
      : attempts
          .filter(
            (item) =>
              item.person === active.person && item.task === active.task,
          )
          .toReversed();
  const firstSuccess = history.find((item) => item.outcome === "passed");

  function row(item: Attempt) {
    return (
      <li key={item.id}>
        <a
          className="submission-row"
          href={address(variant, item.id).toString()}
          onClick={(event) => {
            open(event, item.id);
          }}
        >
          <div className="row-person">
            <strong>{item.name}</strong>
            <span>
              {item.username === null
                ? "Telegram не подключён"
                : `@${item.username}`}
            </span>
          </div>
          <div className="row-task">
            <span>{item.task}</span>
            <span>AI Engineering</span>
          </div>
          <div className="row-result">
            <OutcomeLabel outcome={item.outcome} />
            <span>
              {item.attempt === null
                ? "Через форму"
                : `Попытка ${String(item.attempt)}`}
            </span>
          </div>
          <span className="row-date">{item.date}</span>
          <ChevronRight aria-hidden="true" className="row-arrow" size={18} />
        </a>
      </li>
    );
  }

  const historySection = (
    <section className="submission-section" aria-labelledby="history-heading">
      <h2 id="history-heading">
        {active?.outcome === "none" ? "История сдач" : "История проверок"}
      </h2>
      <ol className="attempt-history">
        {history.map((item) => (
          <li key={item.id}>
            <a
              className={`history-attempt ${item.id === selected ? "history-current" : ""}`}
              href={address(variant, item.id).toString()}
              onClick={(event) => {
                open(event, item.id);
              }}
              aria-current={item.id === selected ? "page" : undefined}
            >
              <span className="history-number">{item.attempt ?? "—"}</span>
              <div>
                <div className="history-title">
                  <strong>
                    {item.attempt === null
                      ? "Сдача через форму"
                      : `Попытка ${String(item.attempt)}`}
                  </strong>
                  <OutcomeLabel outcome={item.outcome} />
                </div>
                <p>{item.summary}</p>
                <span className="history-date">
                  {item.date}
                  {item.id === selected ? " · открыта сейчас" : ""}
                </span>
              </div>
            </a>
          </li>
        ))}
      </ol>
      <p className="quiet-copy">
        Здесь только сохранённые сдачи. Работа ученика между проверками в
        историю не попадает.
      </p>
    </section>
  );

  return (
    <main
      id="authoring-content"
      className="submissions-prototype"
      data-variant={variant}
    >
      {active === undefined ? (
        <>
          <header className="submissions-heading">
            <h1 ref={heading} tabIndex={-1}>
              Сдачи
            </h1>
            <p>Сдачи учеников и результаты самопроверки, новые сверху.</p>
          </header>
          <search className="submission-filters" aria-label="Найти сдачу">
            <label className="submission-search">
              <span className="sr-only">Имя ученика или задание</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Имя ученика или задание"
              />
            </label>
            <label className="submission-status-filter">
              <span className="sr-only">Результат проверки</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                }}
              >
                <option value="all">Все результаты</option>
                <option value="passed">Самопроверка пройдена</option>
                <option value="changes">Нужны исправления</option>
                <option value="missing">Не хватает подтверждений</option>
                <option value="none">Без самопроверки</option>
              </select>
            </label>
            <span className="course-filter-label">AI Engineering</span>
          </search>
          {filtered.length === 0 ? (
            <div className="submission-empty">
              <h2>Сдачи не найдены</h2>
              <p>Попробуйте другое имя или результат проверки.</p>
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Сбросить фильтры
              </Button>
            </div>
          ) : variant === "B" ? (
            <>
              <table className="submissions-table">
                <caption className="sr-only">
                  Все сохранённые сдачи, новые сверху
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Ученик</th>
                    <th scope="col">Задание</th>
                    <th scope="col">Результат</th>
                    <th scope="col">Попытка</th>
                    <th scope="col">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <a
                          href={address("B", item.id).toString()}
                          onClick={(event) => {
                            open(event, item.id);
                          }}
                        >
                          <strong>{item.name}</strong>
                          <span>
                            {item.username === null
                              ? "Telegram не подключён"
                              : `@${item.username}`}
                          </span>
                        </a>
                      </td>
                      <td>{item.task}</td>
                      <td>
                        <OutcomeLabel outcome={item.outcome} />
                      </td>
                      <td>{item.attempt ?? "—"}</td>
                      <td>{item.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="submission-mobile-table">{filtered.map(row)}</ul>
            </>
          ) : variant === "C" ? (
            <div className="submission-date-groups">
              {[...new Set(filtered.map((item) => item.day))].map((day) => (
                <section key={day} aria-label={day}>
                  <h2>{day}</h2>
                  <ul>
                    {filtered.filter((item) => item.day === day).map(row)}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="submissions-list">{filtered.map(row)}</ul>
          )}
          <p className="list-explanation">
            Каждая строка — одна сдача. Неуспешные попытки тоже остаются в
            списке.
          </p>
        </>
      ) : (
        <>
          <a
            className="submission-back"
            href={address(variant, null).toString()}
            onClick={(event) => {
              open(event, null);
            }}
          >
            <ArrowLeft aria-hidden="true" size={17} />
            Все сдачи
          </a>
          <header className="submission-detail-heading">
            <h1 ref={heading} tabIndex={-1}>
              {active.task}
            </h1>
            <p>AI Engineering · {active.chapter}</p>
          </header>
          <div className="submission-person-line">
            <strong>{active.name}</strong>
            {active.username === null ? (
              <span>Telegram не подключён</span>
            ) : (
              <a
                href={`https://t.me/${active.username}`}
                onClick={(event) => {
                  event.preventDefault();
                  setNotice(
                    "В рабочей версии эта ссылка откроет Telegram ученика. Контакт в макете вымышленный.",
                  );
                }}
              >
                @{active.username}
                <ExternalLink aria-hidden="true" size={13} />
              </a>
            )}
            <span>
              {active.date} ·{" "}
              {active.attempt === null
                ? "через форму"
                : `попытка ${String(active.attempt)}`}
            </span>
          </div>
          <section
            className="submission-verdict"
            aria-label="Результат самопроверки"
          >
            <OutcomeLabel outcome={active.outcome} />
            <p>{active.summary}</p>
            {firstSuccess === undefined ? null : (
              <span className="first-success">
                Первая успешная самопроверка — попытка {firstSuccess.attempt}.
              </span>
            )}
          </section>
          <details
            className="submission-disclosure feedback-disclosure"
            key={`feedback-${active.id}`}
            open={expanded || comments[active.id] !== undefined}
          >
            <summary>
              {comments[active.id] === undefined
                ? "Оставить комментарий ученику"
                : "Ваш комментарий"}
            </summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const comment = (
                  drafts[active.id] ??
                  comments[active.id] ??
                  ""
                ).trim();
                if (comment !== "") {
                  setComments((previous) => ({
                    ...previous,
                    [active.id]: comment,
                  }));
                  setNotice(
                    "Комментарий сохранён только в этом макете. Ученик его не получит.",
                  );
                }
              }}
            >
              <label htmlFor="author-comment">
                Комментарий — необязательно
              </label>
              <textarea
                id="author-comment"
                value={drafts[active.id] ?? comments[active.id] ?? ""}
                onChange={(event) => {
                  setDrafts((previous) => ({
                    ...previous,
                    [active.id]: event.target.value,
                  }));
                }}
                rows={3}
                placeholder="Напишите, если хотите помочь ученику"
              />
              <Button
                type="submit"
                disabled={
                  (drafts[active.id] ?? comments[active.id] ?? "").trim() === ""
                }
              >
                Сохранить комментарий
              </Button>
            </form>
          </details>
          {variant === "C" ? historySection : null}
          <details
            className="submission-disclosure"
            key={`report-${active.id}`}
            open={expanded}
          >
            <summary>
              Подробный отчёт
              {active.outcome === "none" ? " ученика" : " по критериям"}
            </summary>
            <div className="submission-report-content">
              {active.outcome === "none" ? (
                <p>
                  Отчёт агента не приложен. Ученик может выполнить самопроверку
                  и сохранить следующую попытку через MCP.
                </p>
              ) : (
                <>
                  <p className="quiet-copy">
                    Требования версии 2. Выводы записал агент ученика.
                  </p>
                  <ul>
                    <li>
                      <div className="criterion-heading">
                        <strong>
                          {active.task === "Заявки клиентов"
                            ? "Повторная отправка не создаёт вторую заявку"
                            : "Доступ выдаёт только руководитель команды"}
                        </strong>
                        <span className="criterion-result">
                          {active.outcome === "changes"
                            ? "Нарушение"
                            : "Подтверждено"}
                        </span>
                      </div>
                      <p>
                        {active.task === "Заявки клиентов"
                          ? "Повторная отправка создаёт вторую заявку: обработчик не ищет сохранённый результат."
                          : active.outcome === "changes"
                            ? "Роль приходит из запроса. Сервер не проверяет её по своим данным."
                            : "Сервер получает роль из данных участника перед выдачей доступа."}
                      </p>
                    </li>
                    <li>
                      <div className="criterion-heading">
                        <strong>
                          {active.task === "Заявки клиентов"
                            ? "Клиент может создать заявку"
                            : "Обычный участник не может выдать доступ"}
                        </strong>
                        <span className="criterion-result">
                          {active.task !== "Заявки клиентов" &&
                          active.outcome !== "passed"
                            ? "Не проверено"
                            : "Подтверждено"}
                        </span>
                      </div>
                      <p>
                        {active.task === "Заявки клиентов"
                          ? "Создание заявки подтверждено результатом проверки."
                          : active.outcome !== "passed"
                            ? "Нет сохранённого результата теста запрета выдачи обычному участнику."
                            : "Обычный участник получает отказ. Результат теста сохранён."}
                      </p>
                    </li>
                  </ul>
                </>
              )}
            </div>
          </details>
          <details
            className="submission-disclosure"
            key={`project-${active.id}`}
            open={expanded}
          >
            <summary>Проект и заметка ученика</summary>
            <div className="submission-report-content">
              <div className="submission-student-note">
                <strong>Заметка ученика</strong>
                <p>{active.note}</p>
              </div>
              <dl>
                <dt>Репозиторий</dt>
                <dd>Пример: github.com/learner/course-project</dd>
                <dt>Проверенный commit</dt>
                <dd>
                  <code>4f2a9c1</code>
                </dd>
                <dt>Версия требований</dt>
                <dd>2</dd>
              </dl>
            </div>
          </details>
          {variant !== "C" ? historySection : null}
        </>
      )}
      <p className="prototype-notice" role="status">
        {notice}
      </p>
      {showVariants ? (
        <aside className="prototype-switcher" aria-label="Варианты макета">
          <button
            type="button"
            aria-label="Предыдущий вариант"
            onClick={() => {
              cycle(-1);
            }}
          >
            <ArrowLeft aria-hidden="true" size={17} />
          </button>
          <div>
            <strong>
              {variant} · {variants.find((item) => item.key === variant)?.name}
            </strong>
            <span>Макет · вымышленные данные</span>
          </div>
          <button
            type="button"
            aria-label="Следующий вариант"
            onClick={() => {
              cycle(1);
            }}
          >
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <details>
            <summary>Состояние</summary>
            <pre>
              {JSON.stringify(
                {
                  variant,
                  screen: active === undefined ? "list" : "submission",
                  submission: selected,
                  query,
                  result: status,
                  savedComments: Object.keys(comments),
                  persistence: "none",
                },
                null,
                2,
              )}
            </pre>
          </details>
        </aside>
      ) : null}
    </main>
  );
}
