"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Inbox,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatSubmissionMoment } from "@/entities/product-task";
import { internalRoute } from "@/shared/routing/internal-route";
import { Button } from "@/shared/ui/button";
import {
  repositoryLink,
  selectionHref,
  submissionsHref,
  type AuthorSubmission,
  type SubmissionSelection,
  type TaskCriterion,
  type FilterProduct,
} from "../model/task-submissions";
import type { TaskSubmissionsPresentation } from "../model/task-submissions-presentation";
import { AuthorFeedbackForm } from "./author-feedback-form.client";
import "./task-submissions.css";

const fieldClass =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";
const statusLabels = {
  confirmed: "Подтверждено",
  violation: "Нарушение",
  not_verified: "Не проверено",
} as const;
const outcomes = {
  passed: "Самопроверка пройдена",
  changes: "Нужны исправления",
  missing: "Не хватает подтверждений",
  none: "Без самопроверки",
} as const;
type Outcome = keyof typeof outcomes;
function OutcomeLabel({ outcome }: { readonly outcome: Outcome }) {
  return (
    <span className={`submission-outcome outcome-${outcome}`}>
      {outcome === "passed" ? <Check aria-hidden="true" size={15} /> : null}
      {outcomes[outcome]}
    </span>
  );
}
function personName(submission: AuthorSubmission) {
  return (
    submission.person.displayName ??
    (submission.person.telegramUsername === null
      ? "Имя не указано"
      : `@${submission.person.telegramUsername}`)
  );
}
function contactLabel(submission: AuthorSubmission) {
  if (submission.person.telegramUsername !== null)
    return `@${submission.person.telegramUsername}`;
  return submission.person.telegramContactState === "not_linked"
    ? "Telegram не привязан"
    : submission.person.telegramContactState === "available"
      ? "В Telegram нет username"
      : "Контакт Telegram недоступен";
}
/** Accepted composition A promoted from proof 7c70aa84 for #1351. */
export function TaskSubmissionsFrame({
  children,
  title = "Сдачи",
  subtitle = "Сдачи учеников и результаты самопроверки, новые сверху.",
  backHref,
}: {
  readonly children: ReactNode;
  readonly title?: string;
  readonly subtitle?: string;
  readonly backHref?: string;
}) {
  return (
    <main
      aria-labelledby="task-submissions-title"
      className="task-submissions"
      data-task-submissions
      id="authoring-content"
      tabIndex={-1}
    >
      {backHref === undefined ? null : (
        <Link className="submission-back" href={internalRoute(backHref)}>
          <ArrowLeft aria-hidden="true" size={17} />
          Все сдачи
        </Link>
      )}
      <header
        className={
          backHref === undefined
            ? "submissions-heading"
            : "submission-detail-heading"
        }
      >
        <h1
          id="task-submissions-title"
          data-submissions-part="title"
          tabIndex={-1}
        >
          {title}
        </h1>
        <p>{subtitle}</p>
      </header>
      {children}
    </main>
  );
}
export function TaskSubmissionsView({
  presentation,
  expanded = false,
}: {
  readonly presentation: TaskSubmissionsPresentation;
  readonly expanded?: boolean;
}) {
  const {
    rows,
    selection,
    products,
    pageHref,
    nextHref,
    newestHref,
    submissionId,
  } = presentation;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const active = rows.find(
    (row) => row.submission.submissionId === submissionId,
  );
  if (active !== undefined)
    return (
      <SubmissionDetail
        key={submissionId}
        row={active}
        presentation={presentation}
        expanded={expanded}
      />
    );
  const filtered = rows.filter(
    ({ submission }) =>
      (status === "all" ||
        status === (submission.selfCheck?.outcome ?? "none")) &&
      `${personName(submission)} ${submission.person.telegramUsername ?? ""} ${submission.task.title}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <TaskSubmissionsFrame>
      <search
        className="submission-filters"
        aria-label="Найти сдачу на странице"
      >
        <label className="submission-search">
          <span className="sr-only">
            Имя ученика или задание на этой странице
          </span>
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
          <span className="sr-only">Результат проверки на этой странице</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          >
            <option value="all">Все результаты</option>
            {Object.entries(outcomes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="course-filter-label">
          На этой странице: {rows.length}
        </span>
      </search>
      <details
        className="submission-filter-more"
        open={
          selection.productId !== undefined || selection.taskCode !== undefined
        }
      >
        <summary>Продукт, глава и задание</summary>
        <SubmissionFilter
          key={pageHref}
          selection={selection}
          products={products}
        />
      </details>
      <section aria-label="Список сдач" data-submissions-part="workspace">
        {filtered.length === 0 ? (
          <div
            className="submission-empty"
            data-submissions-empty
            role="status"
          >
            <Inbox aria-hidden="true" className="size-5" />
            <h2>
              {rows.length === 0
                ? selection.productId !== undefined ||
                  selection.taskCode !== undefined
                  ? "По этому фильтру сдач нет."
                  : "Сдач пока нет"
                : "Сдачи не найдены"}
            </h2>
            <p>
              {rows.length === 0
                ? selection.productId !== undefined ||
                  selection.taskCode !== undefined
                  ? "Выберите другой продукт, главу или задание."
                  : "Сдачи появятся после отправки задания учеником."
                : "Попробуйте другое имя или результат проверки."}
            </p>
            {rows.length === 0 ? null : (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Сбросить поиск
              </Button>
            )}
          </div>
        ) : (
          <ul className="submissions-list" aria-label="Сдачи, новые сверху">
            {filtered.map(({ submission, href }) => (
              <li key={submission.submissionId}>
                <Link className="submission-row" href={internalRoute(href)}>
                  <div className="row-person">
                    <strong>{personName(submission)}</strong>
                    <span>{contactLabel(submission)}</span>
                  </div>
                  <div className="row-task">
                    <span>{submission.task.title}</span>
                    <span>
                      {submission.task.productName ?? "Продукт не найден"}
                    </span>
                  </div>
                  <div className="row-result">
                    <OutcomeLabel
                      outcome={submission.selfCheck?.outcome ?? "none"}
                    />
                    <span>
                      {submission.selfCheck === null
                        ? "Без сохранённого отчёта агента"
                        : `Попытка ${String(submission.selfCheck.attempt)}`}
                    </span>
                  </div>
                  <time className="row-date" dateTime={submission.submittedAt}>
                    {formatSubmissionMoment(submission.submittedAt)}
                  </time>
                  <ChevronRight
                    aria-hidden="true"
                    className="row-arrow"
                    size={18}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {nextHref === null && newestHref === null ? null : (
          <nav className="mt-5 flex flex-wrap gap-4" aria-label="Страницы сдач">
            {newestHref === null ? null : (
              <Button asChild variant="outline">
                <Link href={internalRoute(newestHref)}>К новым сдачам</Link>
              </Button>
            )}
            {nextHref === null ? null : (
              <Button asChild variant="outline">
                <Link href={internalRoute(nextHref)}>Более ранние сдачи</Link>
              </Button>
            )}
          </nav>
        )}
        <p className="list-explanation">
          Каждая строка — одна сдача. Неуспешные самопроверки тоже остаются в
          списке. Поиск и результат фильтруют текущую страницу.
        </p>
      </section>
    </TaskSubmissionsFrame>
  );
}
function SubmissionDetail({
  row,
  presentation,
  expanded,
}: {
  readonly row: TaskSubmissionsPresentation["rows"][number];
  readonly presentation: TaskSubmissionsPresentation;
  readonly expanded: boolean;
}) {
  const { submission, criteria, telegramHref } = row;
  const check = submission.selfCheck;
  const username = submission.person.telegramUsername;
  return (
    <TaskSubmissionsFrame
      title={submission.task.title}
      subtitle={`${submission.task.productName ?? "Продукт не найден"} · ${submission.task.chapterName ?? "Глава удалена"}`}
      backHref={presentation.pageHref}
    >
      <article
        data-submission={submission.submissionId}
        id="selected-submission"
        aria-label="Сдача ученика"
      >
        <div className="submission-person-line">
          <strong>{personName(submission)}</strong>
          {telegramHref === null ? (
            <span>{contactLabel(submission)}</span>
          ) : (
            <a href={telegramHref} rel="noopener noreferrer" target="_blank">
              @{username}
              <ExternalLink aria-hidden="true" size={13} />
            </a>
          )}
          <span>
            <time dateTime={submission.submittedAt}>
              {formatSubmissionMoment(submission.submittedAt)}
            </time>{" "}
            ·{" "}
            {check === null
              ? "без самопроверки"
              : `попытка ${String(check.attempt)}`}{" "}
            · Версия требований {submission.taskVersion}
            {submission.taskVersion === submission.task.currentVersion
              ? ""
              : ` (сейчас ${String(submission.task.currentVersion)})`}
          </span>
        </div>
        <section
          className="submission-verdict"
          aria-label="Результат самопроверки"
        >
          <OutcomeLabel outcome={check?.outcome ?? "none"} />
          <p className="whitespace-pre-line">
            {submission.reviewReport?.summary ??
              (submission.reviewReport === null
                ? "Отчёт агента не приложен."
                : "В этом отчёте нет краткого комментария агента.")}
          </p>
          {check?.firstPassedAttempt == null ? null : (
            <span className="first-success">
              Первая успешная самопроверка — попытка {check.firstPassedAttempt}.
            </span>
          )}
        </section>
        <details
          className="submission-disclosure feedback-disclosure"
          open={expanded || submission.authorFeedback?.comment != null}
        >
          <summary>
            {submission.authorFeedback?.comment == null
              ? "Оставить комментарий ученику"
              : "Ваш комментарий"}
          </summary>
          <AuthorFeedbackForm
            feedback={submission.authorFeedback}
            submissionId={submission.submissionId}
          />
        </details>
        <details className="submission-disclosure" open={expanded}>
          <summary>
            Подробный отчёт{" "}
            {submission.reviewReport === null ? "ученика" : "по критериям"}
          </summary>
          <div className="submission-report-content">
            <Report criteria={criteria} submission={submission} />
            {criteria.length === 0 ? null : (
              <details className="mt-5">
                <summary>Критерии версии {submission.taskVersion}</summary>
                <CriteriaGroup criteria={criteria} level="required" />
                <CriteriaGroup criteria={criteria} level="additional" />
              </details>
            )}
          </div>
        </details>
        <details className="submission-disclosure" open={expanded}>
          <summary>Проект и заметка ученика</summary>
          <div className="submission-report-content">
            <div className="submission-student-note">
              <strong>Заметка ученика</strong>
              <p className="whitespace-pre-line">
                {submission.note === "" ? "Без заметки" : submission.note}
              </p>
            </div>
            <ServiceMark mark={submission.serviceMark} />
          </div>
        </details>
        <section
          className="submission-section"
          aria-labelledby="history-heading"
        >
          <h2 id="history-heading">История самопроверок</h2>
          {presentation.history.length === 0 ? (
            <p className="quiet-copy">Сохранённых самопроверок нет.</p>
          ) : (
            <ol className="attempt-history">
              {presentation.history.map((item) => (
                <li key={item.submissionId}>
                  <Link
                    className={`history-attempt ${item.submissionId === submission.submissionId ? "history-current" : ""}`}
                    href={internalRoute(item.href)}
                    aria-current={
                      item.submissionId === submission.submissionId
                        ? "page"
                        : undefined
                    }
                  >
                    <span className="history-number">
                      {item.selfCheck.attempt}
                    </span>
                    <div>
                      <div className="history-title">
                        <strong>Попытка {item.selfCheck.attempt}</strong>
                        <OutcomeLabel outcome={item.selfCheck.outcome} />
                      </div>
                      <p className="whitespace-pre-line">
                        {item.summary ?? "Краткий комментарий не сохранён."}
                      </p>
                      <span className="history-date">
                        <time dateTime={item.submittedAt}>
                          {formatSubmissionMoment(item.submittedAt)}
                        </time>{" "}
                        · требования версии {item.taskVersion}
                        {item.submissionId === submission.submissionId
                          ? " · открыта сейчас"
                          : ""}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <p className="quiet-copy">
            Здесь только сохранённые отчёты агента. Работа между проверками и
            сдачи без отчёта не считаются попытками.
          </p>
        </section>
      </article>
    </TaskSubmissionsFrame>
  );
}

export function SubmissionFilter({
  selection,
  products,
  disabled = false,
}: {
  readonly selection: SubmissionSelection;
  readonly products: readonly FilterProduct[];
  readonly disabled?: boolean;
}) {
  const [filter, setFilter] = useState(selection);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const product = products.find((item) => item.id === filter.productId);
  const chapter = product?.chapters.find(
    (item) => item.id === filter.chapterId,
  );
  const taskGroups =
    chapter !== undefined
      ? [chapter]
      : (product?.chapters ?? products.flatMap((item) => item.chapters));
  return (
    <form
      action={submissionsHref}
      aria-label="Фильтр сдач"
      className="grid gap-3 py-5 sm:grid-cols-3"
      method="get"
      data-submissions-part="filter"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => {
          router.push(internalRoute(selectionHref(filter)));
        });
      }}
    >
      <Field label="Продукт">
        <select
          className={fieldClass}
          disabled={disabled}
          value={filter.productId ?? ""}
          onChange={(event) => {
            setFilter(
              event.target.value === ""
                ? {}
                : { productId: event.target.value },
            );
          }}
          name="productId"
        >
          <option value="">Все продукты</option>
          {products.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Глава">
        <select
          className={fieldClass}
          value={filter.chapterId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setFilter({
              ...(filter.productId === undefined
                ? {}
                : { productId: filter.productId }),
              ...(value === "" ? {} : { chapterId: value }),
            });
          }}
          disabled={disabled || product === undefined}
          name="chapterId"
        >
          <option value="">
            {product === undefined ? "Выберите продукт" : "Все главы"}
          </option>
          {product?.chapters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Задание">
        <select
          disabled={disabled}
          className={fieldClass}
          value={filter.taskCode ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setFilter({
              ...(filter.productId === undefined
                ? {}
                : { productId: filter.productId }),
              ...(filter.chapterId === undefined
                ? {}
                : { chapterId: filter.chapterId }),
              ...(value === "" ? {} : { taskCode: value }),
            });
          }}
          name="task"
        >
          <option value="">Все задания</option>
          {taskGroups.flatMap((group) =>
            group.tasks.map((task) => (
              <option key={task.code} value={task.code}>
                {task.title}
              </option>
            )),
          )}
        </select>
      </Field>
      <Button
        className="min-h-11 justify-self-start px-5"
        disabled={disabled || pending}
        type="submit"
      >
        {pending ? "Загружаем…" : "Показать"}
      </Button>
    </form>
  );
}

function Field({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function ServiceMark({
  mark,
}: {
  readonly mark: AuthorSubmission["serviceMark"];
}) {
  const link = repositoryLink(mark.repositoryUrl);
  const parts = [
    mark.branch === null ? null : `ветка ${mark.branch}`,
    mark.commit === null ? null : `commit ${mark.commit}`,
    mark.uncommittedChanges === true ? "есть незакоммиченные изменения" : null,
  ].filter((part) => part !== null);
  if (mark.repositoryUrl === null && parts.length === 0)
    return <span className="text-muted-foreground">Нет</span>;
  return (
    <span className="grid gap-0.5 [overflow-wrap:anywhere]">
      {mark.repositoryUrl === null ? null : link === null ? (
        <span>{mark.repositoryUrl}</span>
      ) : (
        <a
          className="text-action underline underline-offset-2"
          href={link}
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          {mark.repositoryUrl}
        </a>
      )}
      {parts.length === 0 ? null : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
          {parts.join(", ")}
        </span>
      )}
    </span>
  );
}

/**
 * The learner's report as plain text: React renders it as text, so markup an agent wrote never
 * runs in the author's browser. The label says whose statement it is.
 */
function Report({
  criteria,
  submission,
}: {
  readonly criteria: readonly TaskCriterion[];
  readonly submission: AuthorSubmission;
}) {
  if (submission.reviewReport === null && submission.reportText === null)
    return (
      <p className="text-sm text-muted-foreground">Отчёта проверки нет.</p>
    );
  const requirementOf = new Map(
    criteria.map((criterion) => [criterion.id, criterion]),
  );
  return (
    <section
      aria-label="Полный отчёт"
      className="grid gap-4"
      data-submission-report
    >
      <h2 className="sr-only">
        {submission.reviewReport === null
          ? "Отчёт ученика из формы"
          : "Отчёт агента ученика"}
      </h2>
      <p className="quiet-copy">
        {submission.reviewReport === null
          ? "Текст ученика, не проверка Platform."
          : "Это отчёт агента ученика, не проверка Platform."}
      </p>
      {submission.reviewReport === null ? (
        <p className="whitespace-pre-line [overflow-wrap:anywhere]">
          {submission.reportText}
        </p>
      ) : (
        <ol className="grid gap-7 text-base leading-[1.65]">
          {submission.reviewReport.criteria.map((item) => {
            const criterion = requirementOf.get(item.criterionId);
            return (
              <li className="grid gap-2" key={item.criterionId}>
                <p className="criterion-heading">
                  <span className="font-semibold [overflow-wrap:anywhere]">
                    {criterion === undefined
                      ? item.criterionId
                      : "requirement" in criterion
                        ? criterion.requirement
                        : criterion.task}
                  </span>
                  <span className="criterion-result">
                    {statusLabels[item.status]}
                  </span>
                </p>
                {criterion === undefined ? null : (
                  <p className="text-xs text-muted-foreground">
                    {criterion.level === "required"
                      ? "Обязательно"
                      : "Дополнительно"}
                    {item.obtainedByRun ? " · получено запуском" : ""}
                  </p>
                )}
                {item.evidence === "" ? null : (
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">
                    <span className="text-muted-foreground">
                      Доказательство:{" "}
                    </span>
                    {item.evidence}
                  </p>
                )}
                {item.gap === "" ? null : (
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">
                    <span className="text-muted-foreground">Пробел: </span>
                    {item.gap}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function CriteriaGroup({
  criteria,
  level,
}: {
  readonly criteria: readonly TaskCriterion[];
  readonly level: TaskCriterion["level"];
}) {
  const items = criteria.filter((criterion) => criterion.level === level);
  if (items.length === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="font-semibold">
        {level === "required" ? "Обязательно" : "Дополнительно"}
      </p>
      <ul className="grid list-disc gap-1 pl-5">
        {items.map((criterion) => (
          <li className="[overflow-wrap:anywhere]" key={criterion.id}>
            {"requirement" in criterion
              ? criterion.requirement
              : criterion.task}
          </li>
        ))}
      </ul>
    </div>
  );
}
