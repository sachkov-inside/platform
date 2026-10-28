"use client";

import { ArrowLeft, Check, ExternalLink, GitBranch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";

import { formatMoscowDateTime } from "@/shared/lib/moscow-format";
import { internalRoute } from "@/shared/routing/internal-route";
import { AdminListHeader } from "@/shared/ui/admin";

import {
  contactLabel,
  personName,
  selfCheckOutcomes,
  type SelfCheckOutcome,
} from "../model/submissions-list";
import {
  repositoryLink,
  type AuthorSubmission,
  type TaskCriterion,
} from "../model/task-submissions";
import type { TaskSubmissionsPresentation } from "../model/task-submissions-presentation";
import { AuthorFeedbackForm } from "./author-feedback-form.client";
import { SubmissionFilters } from "./submission-filters.client";
import { SubmissionsList } from "./submissions-list.client";
import "./task-submissions.css";

const statusLabels = {
  confirmed: "Подтверждено",
  violation: "Нарушение",
  not_verified: "Не проверено",
} as const;
function OutcomeLabel({ outcome }: { readonly outcome: SelfCheckOutcome }) {
  return (
    <span className={`submission-outcome outcome-${outcome}`}>
      {outcome === "passed" ? <Check aria-hidden="true" size={15} /> : null}
      {selfCheckOutcomes[outcome]}
    </span>
  );
}
/**
 * The page frame: the list header of the shared pattern (#1717), or the heading of one submission
 * with the «Все сдачи» return to the list address it was opened from.
 */
export function TaskSubmissionsFrame({
  children,
  title = "Сдачи",
  subtitle,
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
      {backHref === undefined ? (
        <div className="submissions-heading" data-submissions-part="title">
          <AdminListHeader headingId="task-submissions-title" title={title} />
        </div>
      ) : (
        <>
          <Link className="submission-back" href={internalRoute(backHref)}>
            <ArrowLeft aria-hidden="true" size={17} />
            Все сдачи
          </Link>
          <header className="submission-detail-heading">
            <h1
              id="task-submissions-title"
              data-submissions-part="title"
              tabIndex={-1}
            >
              {title}
            </h1>
            {subtitle === undefined ? null : <p>{subtitle}</p>}
          </header>
        </>
      )}
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { rows, submissionId } = presentation;
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
  const navigate = (href: string) => {
    startTransition(() => {
      router.push(internalRoute(href));
    });
  };
  return (
    <TaskSubmissionsFrame>
      <SubmissionFilters
        feedback={presentation.feedback}
        firstProductsHref={presentation.firstProductsHref}
        navigate={navigate}
        nextProductsHref={presentation.nextProductsHref}
        productCursor={presentation.productCursor}
        products={presentation.products}
        selection={presentation.selection}
        shownCount={rows.length}
      />
      <section aria-label="Список сдач" data-submissions-part="workspace">
        <SubmissionsList
          busy={pending}
          navigate={navigate}
          presentation={presentation}
        />
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
              {formatMoscowDateTime(submission.submittedAt)}
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
                          {formatMoscowDateTime(item.submittedAt)}
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
