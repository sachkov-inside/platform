"use client";
import { useSyncExternalStore } from "react";
import { readTaskSubmissions } from "../api/read-task-submissions.browser";
import {
  taskSubmissionsQueryKey,
  taskReviewRefreshIntervalMs,
} from "../model/task-submissions-query";
import { selfRefreshingRead } from "@/shared/api/self-refreshing-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bot, CircleCheck, Eye, Info } from "lucide-react";
import Link from "next/link";
import {
  formatSubmissionDay,
  formatSubmissionMoment,
} from "@/entities/product-task";
import { Button } from "@/shared/ui/button";
import { internalRoute } from "@/shared/routing/internal-route";
import { type OwnSubmissionsView } from "../model/product-task-page";
import { TaskReviewReportView } from "./task-review-report";
import { TaskReviewMessage } from "./task-review-message";
import styles from "./task-submission-workspace.module.css";

const phases = {
  reviewing: "Агент проверяет работу",
  ready: "Отчёт готов — обсуди его с агентом",
  stopped: "Проверка остановлена",
  submitted: "Сдача отправлена",
};

const subscribeToHydration = () => () => undefined;
const readClientHydration = () => true;
const readServerHydration = () => false;

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
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    readClientHydration,
    readServerHydration,
  );
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
  // A streamed boundary hydrates from its server snapshot even if a sibling has updated the cache.
  // A refreshed RSC route (e.g. manual submission) must replace stale initial query data immediately.
  const submissions =
    !hydrated || !live || initial.kind === "guest"
      ? initial
      : (query.data ?? initial);
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
  const currentProgress = progress?.phase === "submitted" ? null : progress;
  const updatedAt = currentProgress?.updatedAt ?? submissions.latestSubmittedAt;
  return (
    <div
      className="grid gap-4"
      data-task-history
      aria-busy={hydrated && query.isFetching}
    >
      <div className={styles["resultHeader"]}>
        <span
          className={styles["resultIcon"]}
          data-phase={currentProgress?.phase}
          aria-hidden="true"
        >
          {currentProgress?.phase === "ready" ? (
            <CircleCheck size={22} />
          ) : (
            <Bot size={22} />
          )}
        </span>
        <div className="grid min-w-0 gap-1">
          <p className="text-base font-semibold">
            {currentProgress == null
              ? submissions.submissions.length === 0
                ? "Ожидаем сообщения агента"
                : "Результаты получены"
              : phases[currentProgress.phase]}
          </p>
          {updatedAt == null ? null : (
            <p className="text-xs text-muted-foreground">
              Обновлено{" "}
              <time dateTime={updatedAt}>
                {formatSubmissionMoment(updatedAt)}
              </time>
            </p>
          )}
        </div>
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
      {hydrated && query.isError ? (
        <p role="status" className="text-sm text-destructive">
          Не удалось получить обновления. Показаны последние загруженные данные.
        </p>
      ) : null}
      <div
        role="log"
        aria-label="Сообщения проверки"
        aria-live="polite"
        aria-relevant="additions text"
        className="grid gap-5"
      >
        {submissions.submissions.length === 0 ? null : (
          <ol className="grid gap-5" data-own-submissions>
            {submissions.submissions.map((submission) => {
              const feedback = submission.authorFeedback;
              return (
                <li
                  key={submission.submissionId}
                  data-submission={submission.submissionId}
                  className="grid gap-3"
                >
                  <TaskReviewMessage
                    author={submission.source === "mcp" ? "Агент" : "Ты"}
                    at={submission.submittedAt}
                  >
                    <p className="mb-2 font-medium">Сдача отправлена</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {submission.source === "mcp"
                        ? "Через агента"
                        : "Через форму"}
                    </p>
                    {submission.taskVersion ===
                    submissions.currentVersion ? null : (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Версия требований {submission.taskVersion} (сейчас{" "}
                        {submissions.currentVersion})
                      </p>
                    )}
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
                        <p className="whitespace-pre-line">{submission.note}</p>
                      </details>
                    )}
                    {submission.reportText === null ? null : (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                          Мой отчёт
                        </summary>
                        <p className="whitespace-pre-line">
                          {submission.reportText}
                        </p>
                      </details>
                    )}
                    {submission.repositoryUrl === null ? null : (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                          Проект
                        </summary>
                        <p className="break-all">
                          {submission.repositoryUrl.replace(
                            /^https?:\/\//u,
                            "",
                          )}
                        </p>
                      </details>
                    )}
                  </TaskReviewMessage>
                  {feedback?.comment == null ? null : (
                    <TaskReviewMessage author="Автор" at={feedback.reviewedAt}>
                      <p className="mb-1 font-medium">Комментарий автора</p>
                      <p className="whitespace-pre-line">{feedback.comment}</p>
                    </TaskReviewMessage>
                  )}
                  {feedback?.reviewedAt == null ? null : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Eye aria-hidden="true" className="size-4" />
                      Посмотрел автор {formatSubmissionDay(feedback.reviewedAt)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {progress === null ||
        progress === undefined ||
        progress.phase === "submitted" ? null : (
          <section
            className="grid gap-3"
            aria-label="Текущая проверка"
            data-task-review-progress
          >
            <TaskReviewMessage author="Агент" at={progress.updatedAt}>
              <p className="whitespace-pre-line text-sm leading-6">
                {progress.summary}
              </p>
              <p className="text-xs text-muted-foreground">
                Ещё не отправлено.
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
            </TaskReviewMessage>
          </section>
        )}
        {submissions.submissions.length === 0 && currentProgress == null ? (
          <p className="py-4 text-sm leading-6 text-muted-foreground">
            {submissions.continued === true
              ? "Более ранних сдач нет."
              : "Передай запрос агенту. Его сообщение появится здесь, когда он отправит обновление через MCP."}
          </p>
        ) : null}
      </div>
      <p className={styles["discussionHint"]}>
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Вопросы и новую проверку обсуждай со своим агентом в папке проекта.
      </p>
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
