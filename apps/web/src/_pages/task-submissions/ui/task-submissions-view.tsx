import { Bot, Eye, FileText, GitBranch, Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatSubmissionMoment } from "@/entities/guide-task";
import { internalRoute } from "@/shared/routing/internal-route";
import { Button } from "@/shared/ui/button";

import {
  criteriaOf,
  repositoryLink,
  selectionHref,
  submissionsHref,
  type AuthorSubmission,
  type SubmissionSelection,
  type TaskCriterion,
  type TaskSubmissions,
} from "../model/task-submissions";
import { AuthorFeedbackForm } from "./author-feedback-form.client";

const fieldClass =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";
const cardClass =
  "min-w-0 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6";

const statusLabels = {
  confirmed: "Подтверждено",
  violation: "Нарушение",
  not_verified: "Не проверено",
} as const;

/** The section frame: the authoring content column, shared by the list and its states. */
export function TaskSubmissionsFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <main
      aria-labelledby="task-submissions-title"
      className="flex h-full min-h-svh flex-col overflow-y-auto bg-background text-foreground md:min-h-0 md:overscroll-y-contain"
      data-task-submissions
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto grid w-full max-w-4xl content-start gap-6 px-4 py-7 pb-16 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
        <header className="grid gap-2">
          <h1
            className="text-balance text-3xl font-bold tracking-[-0.04em]"
            id="task-submissions-title"
          >
            Сдачи
          </h1>
          <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
            Сдачи заданий учеников, новые сверху. Отчёт пишет агент ученика:
            Platform его не проверяет. Отзыв необязателен, оценок нет.
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}

/**
 * Temporary semantic UI for #948.
 * Replace through #967 after Storybook acceptance.
 */
export function TaskSubmissionsView({
  continued,
  selection,
  submissions,
}: {
  /** The list continues an earlier page: it offers a way back to the newest submissions. */
  readonly continued: boolean;
  readonly selection: SubmissionSelection;
  readonly submissions: TaskSubmissions;
}) {
  const filtered =
    selection.guideId !== undefined || selection.taskCode !== undefined;
  return (
    <TaskSubmissionsFrame>
      <SubmissionFilter selection={selection} submissions={submissions} />
      {submissions.submissions.length === 0 ? (
        <p
          className="flex items-start gap-3 rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-6 text-muted-foreground"
          data-submissions-empty
        >
          <Inbox aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {filtered
            ? "По этому фильтру сдач нет."
            : "Сдач пока нет. Они появятся, когда ученики сдадут задания через учебный MCP или форму на странице задания."}
        </p>
      ) : (
        <ol aria-label="Сдачи, новые сверху" className="grid gap-4">
          {submissions.submissions.map((submission) => (
            <SubmissionCard
              criteria={criteriaOf(submissions, submission)}
              key={submission.submissionId}
              submission={submission}
            />
          ))}
        </ol>
      )}
      {submissions.nextCursor === null && !continued ? null : (
        <nav
          aria-label="Страницы сдач"
          className="flex flex-wrap items-center gap-3"
        >
          {continued ? (
            <Button asChild variant="outline">
              <Link href={internalRoute(selectionHref(selection))}>
                К новым сдачам
              </Link>
            </Button>
          ) : null}
          {submissions.nextCursor === null ? null : (
            <Button asChild variant="outline">
              <Link
                href={internalRoute(
                  selectionHref(selection, submissions.nextCursor),
                )}
              >
                Более ранние сдачи
              </Link>
            </Button>
          )}
        </nav>
      )}
    </TaskSubmissionsFrame>
  );
}

function SubmissionFilter({
  selection,
  submissions,
}: {
  readonly selection: SubmissionSelection;
  readonly submissions: TaskSubmissions;
}) {
  const guide = submissions.guides.find(
    (item) => item.id === selection.guideId,
  );
  const chapter = guide?.chapters.find(
    (item) => item.id === selection.chapterId,
  );
  const taskGroups =
    chapter !== undefined
      ? [chapter]
      : (guide?.chapters ??
        submissions.guides.flatMap((item) => item.chapters));
  return (
    <form
      action={submissionsHref}
      aria-label="Фильтр сдач"
      className={`${cardClass} grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end`}
      method="get"
    >
      <Field label="Продукт">
        <select
          className={fieldClass}
          defaultValue={selection.guideId ?? ""}
          name="guideId"
        >
          <option value="">Все продукты</option>
          {submissions.guides.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Глава">
        <select
          className={fieldClass}
          defaultValue={selection.chapterId ?? ""}
          disabled={guide === undefined}
          name="chapterId"
        >
          <option value="">
            {guide === undefined ? "Выберите продукт" : "Все главы"}
          </option>
          {guide?.chapters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Задание">
        <select
          className={fieldClass}
          defaultValue={selection.taskCode ?? ""}
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
        className="min-h-11 px-5 sm:col-span-2 lg:col-span-1"
        type="submit"
      >
        Показать
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

function SubmissionCard({
  criteria,
  submission,
}: {
  readonly criteria: readonly TaskCriterion[];
  readonly submission: AuthorSubmission;
}) {
  const feedback = submission.authorFeedback;
  const reviewed = feedback !== null && feedback.reviewedAt !== null;
  const titleId = `submission-${submission.submissionId}`;
  return (
    <li
      aria-labelledby={titleId}
      className={`${cardClass} grid gap-4`}
      data-submission={submission.submissionId}
    >
      <header className="grid gap-1.5">
        <p className="text-xs text-muted-foreground">
          {submission.task.guideName} · {submission.task.chapterName}
        </p>
        <h2
          className="text-lg font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]"
          id={titleId}
        >
          {submission.task.title}
        </h2>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={submission.submittedAt}>
            {formatSubmissionMoment(submission.submittedAt)}
          </time>
          {submission.source === "mcp" ? (
            <span className="inline-flex items-center gap-1">
              <Bot aria-hidden="true" className="size-3.5" />
              Через агента
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <FileText aria-hidden="true" className="size-3.5" />
              Через форму
            </span>
          )}
          <span>
            Версия требований {submission.taskVersion}
            {submission.taskVersion === submission.task.currentVersion
              ? ""
              : ` (сейчас ${String(submission.task.currentVersion)})`}
          </span>
          {reviewed ? (
            <span className="inline-flex items-center gap-1 font-medium text-[color:var(--callout-good)]">
              <Eye aria-hidden="true" className="size-3.5" />
              Посмотрел автор
            </span>
          ) : null}
        </p>
      </header>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Ученик</dt>
        <dd className="grid min-w-0 gap-0.5">
          <span className="break-all font-mono text-xs">
            {submission.person.accountId}
          </span>
          <span className="text-xs text-muted-foreground">
            {submission.person.telegramIdentityRef ?? "Telegram не привязан"}
          </span>
        </dd>
        <dt className="text-muted-foreground">Заметка ученика</dt>
        <dd className="min-w-0 whitespace-pre-line leading-6 [overflow-wrap:anywhere]">
          {submission.note === "" ? (
            <span className="text-muted-foreground">Без заметки</span>
          ) : (
            submission.note
          )}
        </dd>
        <dt className="text-muted-foreground">Служебная пометка</dt>
        <dd className="min-w-0">
          <ServiceMark mark={submission.serviceMark} />
        </dd>
      </dl>

      <Report criteria={criteria} submission={submission} />

      {criteria.length === 0 ? null : (
        <details className="group">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
            Критерии версии {submission.taskVersion}
          </summary>
          <div className="mt-2 grid gap-3 text-sm leading-6">
            <CriteriaGroup criteria={criteria} level="required" />
            <CriteriaGroup criteria={criteria} level="additional" />
          </div>
        </details>
      )}

      <div className="grid gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Отзыв автора</h3>
        <AuthorFeedbackForm
          feedback={feedback}
          submissionId={submission.submissionId}
        />
      </div>
    </li>
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
    <details className="group" data-submission-report>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
        {submission.reviewReport === null
          ? "Отчёт ученика из формы"
          : "Отчёт агента ученика"}
      </summary>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {submission.reviewReport === null
          ? "Текст ученика, не проверка Platform."
          : "Это отчёт агента ученика, не проверка Platform."}
      </p>
      {submission.reviewReport === null ? (
        <p className="mt-3 whitespace-pre-line text-sm leading-6 [overflow-wrap:anywhere]">
          {submission.reportText}
        </p>
      ) : (
        <ol className="mt-3 grid gap-3 text-sm leading-6">
          {submission.reviewReport.criteria.map((item) => {
            const criterion = requirementOf.get(item.criterionId);
            return (
              <li
                className="grid gap-1 rounded-xl border border-border p-3"
                key={item.criterionId}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {criterion?.requirement ?? item.criterionId}
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
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
    </details>
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
            {criterion.requirement}
          </li>
        ))}
      </ul>
    </div>
  );
}
