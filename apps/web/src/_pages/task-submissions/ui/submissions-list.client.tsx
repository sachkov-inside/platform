"use client";

import Link from "next/link";

import { formatMoscowDateTime } from "@/shared/lib/moscow-format";
import { internalRoute } from "@/shared/routing/internal-route";
import {
  AdminCursorPagination,
  AdminEmptyState,
  AdminNoResults,
  AdminTable,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  contactCaption,
  personName,
  productLine,
  selfCheckLine,
  versionLines,
} from "../model/submissions-list";
import {
  defaultSubmissionsAddress,
  isDefaultView,
  submissionsListHref,
} from "../model/task-submissions";
import type { TaskSubmissionsPresentation } from "../model/task-submissions-presentation";

type Row = TaskSubmissionsPresentation["rows"][number];

const columns: readonly AdminTableColumn<Row>[] = [
  {
    id: "person",
    header: "Человек",
    cell: ({ submission }) => contactCaption(submission),
  },
  {
    id: "task",
    header: "Продукт и задание",
    width: "24%",
    cell: ({ submission }) => (
      <span className="submission-cell">
        <span>{submission.task.title}</span>
        <span className="submission-cell-caption">
          {productLine(submission)}
        </span>
      </span>
    ),
  },
  {
    id: "version",
    header: "Версия требований",
    width: "12%",
    cell: ({ submission }) => {
      const { version, current } = versionLines(submission);
      return (
        <span className="submission-cell">
          <span>{version}</span>
          {current === null ? null : (
            <span className="submission-cell-caption">{current}</span>
          )}
        </span>
      );
    },
  },
  {
    id: "submittedAt",
    header: "Время",
    width: "13%",
    cell: ({ submission }) => (
      <time className="tabular-nums" dateTime={submission.submittedAt}>
        {formatMoscowDateTime(submission.submittedAt)}
      </time>
    ),
  },
  {
    id: "state",
    header: "Состояние",
    width: "21%",
    cell: ({ submission, state }) => (
      <span className="submission-cell">
        <StateBadge state={state} />
        <span className="submission-cell-caption">
          {selfCheckLine(submission)}
        </span>
      </span>
    ),
  },
];

/**
 * The submissions of one page in the shared list pattern (#1717). A row opens the submission at its
 * own address; the list has no rare row actions, so it has no «⋯». An empty page with a
 * continuation is not an empty list: it keeps its pagination.
 */
export function SubmissionsList({
  presentation,
  busy,
  navigate,
}: {
  readonly presentation: TaskSubmissionsPresentation;
  readonly busy: boolean;
  readonly navigate: (href: string) => void;
}) {
  const { rows, nextHref, newestHref, selection, feedback } = presentation;
  const pagination = (
    <AdminCursorPagination
      label="Страницы сдач"
      newerHref={newestHref === null ? null : internalRoute(newestHref)}
      olderHref={nextHref === null ? null : internalRoute(nextHref)}
    />
  );
  if (rows.length === 0)
    return (
      <>
        <EmptySubmissions
          continued={newestHref !== null}
          defaultView={isDefaultView({ selection, feedback })}
          feedback={feedback}
          hasMore={nextHref !== null}
          onReset={() => {
            navigate(submissionsListHref(defaultSubmissionsAddress));
          }}
          unfiltered={
            selection.productId === undefined &&
            selection.chapterId === undefined &&
            selection.taskCode === undefined
          }
        />
        {pagination}
      </>
    );
  return (
    <>
      <AdminTable
        busy={busy}
        caption="Сдачи, новые сверху"
        columns={columns}
        mobileItem={({ submission, state }) => ({
          title: personName(submission),
          caption: `${submission.task.title} · ${submission.task.productName ?? "Продукт не найден"}`,
          badge: <StateBadge state={state} />,
          metric: (
            <time dateTime={submission.submittedAt}>
              {formatMoscowDateTime(submission.submittedAt)}
            </time>
          ),
        })}
        rowHref={(row) => internalRoute(row.href)}
        rowKey={(row) => row.submission.submissionId}
        rowTitle={({ submission }) => personName(submission)}
        rows={rows}
      />
      {pagination}
      <p className="list-explanation">
        В каждой строке одна сдача. Неуспешные самопроверки тоже остаются в
        списке.
      </p>
    </>
  );
}

function EmptySubmissions({
  continued,
  defaultView,
  feedback,
  hasMore,
  onReset,
  unfiltered,
}: {
  readonly continued: boolean;
  readonly defaultView: boolean;
  readonly feedback: TaskSubmissionsPresentation["feedback"];
  readonly hasMore: boolean;
  readonly onReset: () => void;
  readonly unfiltered: boolean;
}) {
  if (hasMore)
    return (
      <AdminNoResults
        description="Более ранние сдачи на следующей странице."
        title="На этой странице сдач нет"
      />
    );
  if (continued)
    return (
      <AdminNoResults
        description="Вернитесь к новым сдачам."
        title="Более ранних сдач нет"
      />
    );
  if (defaultView)
    return (
      <AdminEmptyState
        action={
          <Button asChild className="min-h-11 px-4" variant="outline">
            <Link
              href={internalRoute(
                submissionsListHref({ selection: {}, feedback: "all" }),
              )}
            >
              Показать все сдачи
            </Link>
          </Button>
        }
        description="Новых сдач без комментария нет."
        title="Все сдачи прокомментированы"
      />
    );
  if (unfiltered && feedback === "all")
    return (
      <AdminEmptyState
        description="Сдачи появятся после отправки задания учеником."
        title="Сдач пока нет"
      />
    );
  return (
    <AdminNoResults
      description={
        feedback === "awaiting"
          ? "По этому фильтру нет сдач без комментария."
          : feedback === "given"
            ? "По этому фильтру нет сдач с комментарием."
            : "По этому фильтру сдач нет."
      }
      onReset={onReset}
    />
  );
}
