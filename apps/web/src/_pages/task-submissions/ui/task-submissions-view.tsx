"use client";

import { Bot, FileText, GitBranch, Inbox } from "lucide-react";
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
import {
  useFeedbackDraft,
  useTaskSubmissionsRuntime,
} from "./task-submissions-runtime.client";
import { AuthorFeedbackForm } from "./author-feedback-form.client";

const fieldClass =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

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
      <div className="mx-auto grid w-full max-w-7xl content-start gap-7 px-4 py-7 pb-16 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
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

/** Accepted #967 composition: a queue and one complete report; stacked on phones. */
export function TaskSubmissionsView({
  presentation,
}: {
  readonly presentation: TaskSubmissionsPresentation;
}) {
  const { rows, selection, products, pageHref, nextHref, newestHref } =
    presentation;
  const runtime = useTaskSubmissionsRuntime();
  const selected =
    rows.find(
      (row) => row.submission.submissionId === runtime.selected[pageHref],
    ) ?? rows[0];
  const filtered =
    selection.productId !== undefined || selection.taskCode !== undefined;
  return (
    <TaskSubmissionsFrame>
      <SubmissionFilter
        key={pageHref}
        products={products}
        selection={selection}
      />
      {selected === undefined ? (
        <div
          className="flex items-start gap-3 py-10"
          data-submissions-empty
          role="status"
        >
          <Inbox aria-hidden="true" className="size-5 shrink-0" />
          <div className="grid gap-2">
            <h2 className="text-lg font-semibold">
              {filtered ? "По этому фильтру сдач нет." : "Сдач пока нет"}
            </h2>
            <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
              Сдачи появятся, когда ученики отправят задания через своего агента
              или форму на странице задания.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          <section aria-label="Очередь сдач" className="min-w-0">
            <h2 className="mb-3 text-sm font-semibold">
              Сдачи на странице: {rows.length}
            </h2>
            <ol aria-label="Сдачи, новые сверху" className="grid gap-2">
              {rows.map(({ submission }) => (
                <SubmissionQueueItem
                  key={submission.submissionId}
                  selected={
                    selected.submission.submissionId === submission.submissionId
                  }
                  submission={submission}
                  onSelect={() => {
                    runtime.choose(pageHref, submission.submissionId);
                  }}
                />
              ))}
            </ol>
            {nextHref === null && newestHref === null ? null : (
              <nav
                aria-label="Страницы сдач"
                className="mt-4 flex flex-wrap items-center gap-3"
              >
                {newestHref === null ? null : (
                  <Button asChild variant="outline">
                    <Link href={internalRoute(newestHref)}>К новым сдачам</Link>
                  </Button>
                )}
                {nextHref === null ? null : (
                  <Button asChild variant="outline">
                    <Link href={internalRoute(nextHref)}>
                      Более ранние сдачи
                    </Link>
                  </Button>
                )}
              </nav>
            )}
          </section>
          <SubmissionDetail
            key={selected.submission.submissionId}
            criteria={selected.criteria}
            submission={selected.submission}
          />
        </div>
      )}
      {selected !== undefined || newestHref === null ? null : (
        <Link
          className="text-action underline"
          href={internalRoute(newestHref)}
        >
          К новым сдачам
        </Link>
      )}
    </TaskSubmissionsFrame>
  );
}

function SubmissionQueueItem({
  submission,
  selected,
  onSelect,
}: {
  readonly submission: AuthorSubmission;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { draft } = useFeedbackDraft(
    submission.submissionId,
    submission.authorFeedback,
  );
  const reviewed = draft.saved !== null && draft.saved.reviewedAt !== null;
  return (
    <li>
      <button
        aria-controls="selected-submission"
        aria-pressed={selected}
        className={`grid w-full min-w-0 gap-2 rounded-xl border p-4 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30 [overflow-wrap:anywhere] ${selected ? "border-transparent bg-secondary" : "border-border"}`}
        onClick={onSelect}
        type="button"
      >
        <span className="text-sm font-semibold">{submission.task.title}</span>
        <span className="text-xs text-muted-foreground">
          {formatSubmissionMoment(submission.submittedAt)} · Ученик{" "}
          {submission.person.accountId.slice(-6)}
        </span>
        <span className="text-xs">
          {reviewed ? "Посмотрел автор" : "Автор ещё не отметил"}
        </span>
      </button>
    </li>
  );
}

function SubmissionFilter({
  selection,
  products,
}: {
  readonly selection: SubmissionSelection;
  readonly products: readonly FilterProduct[];
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
      className="grid gap-3 border-b border-border pb-6 sm:grid-cols-3"
      method="get"
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
          disabled={product === undefined}
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
        disabled={pending}
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

function SubmissionDetail({
  criteria,
  submission,
}: {
  readonly criteria: readonly TaskCriterion[];
  readonly submission: AuthorSubmission;
}) {
  const feedback = submission.authorFeedback;
  const titleId = `submission-${submission.submissionId}`;
  return (
    <article
      aria-labelledby={titleId}
      id="selected-submission"
      className="grid min-w-0 content-start gap-6 [overflow-wrap:anywhere]"
      data-submission={submission.submissionId}
    >
      <header className="grid gap-1.5">
        <p className="text-xs text-muted-foreground">
          {submission.task.productName ?? "Продукт не найден"} ·{" "}
          {submission.task.chapterName ?? "глава удалена"}
        </p>
        <h2
          className="text-2xl font-semibold tracking-[-0.025em] [overflow-wrap:anywhere]"
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
        </p>
      </header>

      <dl className="grid gap-3 rounded-xl bg-secondary/60 p-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
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
    </article>
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
      <h3 className="text-lg font-semibold">
        {submission.reviewReport === null
          ? "Отчёт ученика из формы"
          : "Отчёт агента ученика"}
      </h3>
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
        <ol className="grid gap-5 text-sm leading-7">
          {submission.reviewReport.criteria.map((item) => {
            const criterion = requirementOf.get(item.criterionId);
            return (
              <li
                className="grid gap-2 border-t border-border pt-4"
                key={item.criterionId}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {criterion === undefined
                      ? item.criterionId
                      : "requirement" in criterion
                        ? criterion.requirement
                        : criterion.task}
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
