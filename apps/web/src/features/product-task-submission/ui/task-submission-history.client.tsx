"use client";
import { readTaskSubmissions } from "../api/read-task-submissions.browser";
import {
  taskSubmissionsQueryKey,
  taskReviewRefreshIntervalMs,
} from "../model/task-submissions-query";
import { selfRefreshingRead } from "@/shared/api/self-refreshing-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bot, Eye, FileText, MessageSquareText, RefreshCw } from "lucide-react";
import Link from "next/link";
import {
  formatSubmissionDay,
  formatSubmissionMoment,
} from "@/entities/product-task";
import { Button } from "@/shared/ui/button";
import { internalRoute } from "@/shared/routing/internal-route";
import { type OwnSubmissionsView } from "../model/product-task-page";
import { TaskReviewReportView } from "./task-review-report";

const phases = {
  reviewing: "Агент проверяет работу",
  ready: "Отчёт готов — обсуди его с агентом",
  stopped: "Проверка остановлена",
  submitted: "Сдача отправлена",
};

export function TaskSubmissionHistory({
  initial,
  code,
  currentVersion,
  returnTo,
  historyAnchor,
  live = false,
  after,
  accountId = null,
}: {
  readonly initial: OwnSubmissionsView;
  readonly code: string;
  readonly currentVersion: number;
  readonly returnTo: string;
  readonly historyAnchor: string;
  readonly live?: boolean;
  readonly after?: string | undefined;
  readonly accountId?: string | null;
}) {
  const router = useRouter();
  const historyHref = (cursor?: string) => {
    const url = new URL(returnTo, "http://inside.invalid");
    if (cursor === undefined) url.searchParams.delete("attemptsAfter");
    else url.searchParams.set("attemptsAfter", cursor);
    url.hash = historyAnchor;
    return internalRoute(`${url.pathname}${url.search}${url.hash}`);
  };
  const query = useQuery({
    queryKey: taskSubmissionsQueryKey(accountId, code, after),
    ...selfRefreshingRead,
    initialData: live ? undefined : initial,
    enabled: live && accountId !== null && initial.kind !== "guest",
    refetchInterval:
      live && accountId !== null && initial.kind !== "guest"
        ? taskReviewRefreshIntervalMs
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    retry: false,
    queryFn: ({ signal }) => readTaskSubmissions(code, after, signal),
  });
  // A refreshed RSC route (e.g. manual submission) must replace stale initial query data immediately.
  const submissions =
    !live || initial.kind === "guest" ? initial : (query.data ?? initial);
  const refresh = () => {
    if (live && accountId !== null) {
      void query.refetch();
    } else {
      router.refresh();
    }
  };
  if (submissions.kind === "guest")
    return (
      <div className="grid justify-items-start gap-3 text-sm leading-6">
        <p>Войди, чтобы видеть свои сдачи и обновления агента.</p>
        <form action="/auth/sign-in" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" variant="outline">
            Войти через Telegram
          </Button>
        </form>
      </div>
    );
  if (submissions.kind === "unavailable")
    return (
      <div role="status" className="grid justify-items-start gap-3 text-sm">
        <p>Сдачи сейчас не загрузились.</p>
        <Button type="button" variant="outline" onClick={refresh}>
          Повторить
        </Button>
      </div>
    );
  const progress = submissions.reviewProgress;
  const versions = new Map(
    submissions.versions.map((version) => [version.version, version.criteria]),
  );
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {live && accountId !== null
            ? "Обновляется по сообщениям агента"
            : "Сохранённые результаты"}
        </p>
        <Button
          variant="ghost"
          type="button"
          onClick={refresh}
          disabled={query.isFetching}
          className="min-h-11"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Обновить
        </Button>
      </div>
      {submissions.currentVersion === currentVersion ? null : (
        <div
          role="status"
          className="grid justify-items-start gap-2 text-sm leading-6"
        >
          <p>Требования обновились. Обнови задание перед следующей сдачей.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              router.refresh();
            }}
          >
            Обновить задание
          </Button>
        </div>
      )}
      {query.isError ? (
        <p role="status" className="text-sm text-destructive">
          Не удалось получить обновления. Показаны последние загруженные данные.
        </p>
      ) : null}
      {progress === null ||
      progress === undefined ||
      progress.phase === "submitted" ? null : (
        <section
          className="grid gap-3 rounded-xl bg-muted p-4"
          aria-label="Текущая проверка"
          data-task-review-progress
        >
          <p role="status" className="text-sm font-semibold">
            {phases[progress.phase]}
          </p>
          <p className="whitespace-pre-line text-sm leading-6">
            {progress.summary}
          </p>
          <p className="text-xs text-muted-foreground">
            Обновлено{" "}
            <time dateTime={progress.updatedAt}>
              {formatSubmissionMoment(progress.updatedAt)}
            </time>
            . Ещё не отправлено.
          </p>
          {progress.taskVersion === submissions.currentVersion ? null : (
            <p className="text-sm">
              Требования изменились. Попроси агента проверить работу заново.
            </p>
          )}
          {progress.reviewReport === null ? null : (
            <TaskReviewReportView
              report={progress.reviewReport}
              criteria={versions.get(progress.taskVersion) ?? []}
            />
          )}
        </section>
      )}
      {submissions.submissions.length === 0 ? (
        <p className="py-4 text-sm leading-6 text-muted-foreground">
          {submissions.continued === true
            ? "Более ранних сдач нет."
            : "Сдач пока нет. После отправки здесь появятся результат проверки и ответ автора."}
        </p>
      ) : (
        <ol className="divide-y divide-border" data-own-submissions>
          {submissions.submissions.map((submission) => {
            const feedback = submission.authorFeedback;
            return (
              <li
                key={submission.submissionId}
                data-submission={submission.submissionId}
                className="grid gap-3 py-5 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-base font-semibold">
                    <time dateTime={submission.submittedAt}>
                      {formatSubmissionMoment(submission.submittedAt)}
                    </time>
                  </h5>
                  <span className="text-xs font-medium">Сдача отправлена</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {submission.source === "mcp" ? (
                      <Bot aria-hidden="true" className="size-4" />
                    ) : (
                      <FileText aria-hidden="true" className="size-4" />
                    )}
                    {submission.source === "mcp"
                      ? "Через агента"
                      : "Через форму"}
                  </span>
                  {submission.taskVersion ===
                  submissions.currentVersion ? null : (
                    <span>
                      Версия требований {submission.taskVersion} (сейчас{" "}
                      {submissions.currentVersion})
                    </span>
                  )}
                  {submission.repositoryUrl === null ? null : (
                    <span className="break-all">
                      {submission.repositoryUrl.replace(/^https?:\/\//u, "")}
                    </span>
                  )}
                </p>
                {submission.reviewReport == null ? null : (
                  <TaskReviewReportView
                    report={submission.reviewReport}
                    criteria={versions.get(submission.taskVersion) ?? []}
                  />
                )}
                {submission.note.length === 0 ? null : (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                      Моя заметка
                    </summary>
                    <p className="whitespace-pre-line text-sm leading-6">
                      {submission.note}
                    </p>
                  </details>
                )}
                {submission.reportText === null ? null : (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                      Мой отчёт
                    </summary>
                    <p className="whitespace-pre-line text-sm leading-6">
                      {submission.reportText}
                    </p>
                  </details>
                )}
                <div className="grid gap-2 border-t border-border pt-3 text-sm leading-6">
                  {feedback?.reviewedAt == null ? null : (
                    <p className="flex items-center gap-2">
                      <Eye aria-hidden="true" className="size-4" />
                      Посмотрел автор {formatSubmissionDay(feedback.reviewedAt)}
                    </p>
                  )}
                  {feedback?.comment == null ? null : (
                    <figure>
                      <figcaption className="mb-1 flex items-center gap-2 font-medium">
                        <MessageSquareText
                          aria-hidden="true"
                          className="size-4"
                        />
                        Комментарий автора
                      </figcaption>
                      <blockquote className="whitespace-pre-line">
                        {feedback.comment}
                      </blockquote>
                    </figure>
                  )}
                  {feedback?.reviewedAt == null && feedback?.comment == null ? (
                    <p className="text-muted-foreground">
                      Автор ещё не смотрел.
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <nav
        aria-label="Страницы моих сдач"
        className="flex flex-wrap gap-4 text-sm"
      >
        {submissions.continued !== true ? null : (
          <Link className="min-h-11 py-2 underline" href={historyHref()}>
            К новым сдачам
          </Link>
        )}
        {submissions.nextCursor === null ? null : (
          <Link
            className="min-h-11 py-2 underline"
            href={historyHref(submissions.nextCursor)}
          >
            Предыдущие сдачи
          </Link>
        )}
      </nav>
    </div>
  );
}
