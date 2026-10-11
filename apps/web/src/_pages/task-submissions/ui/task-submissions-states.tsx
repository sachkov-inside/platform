import { CircleAlert, LockKeyhole, LogIn } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import { StatusPanel } from "@/shared/ui/status-panel";

import { submissionsHref } from "../model/task-submissions";
import {
  SubmissionFilter,
  TaskSubmissionsFrame,
} from "./task-submissions-view.client";

export function TaskSubmissionsState({
  kind,
  returnTo = submissionsHref,
}: {
  readonly kind: "unauthorized" | "forbidden" | "unavailable" | "not_found";
  /** The filtered address to come back to after sign-in. */
  readonly returnTo?: string;
}) {
  return (
    <TaskSubmissionsFrame>
      {kind === "not_found" ? (
        <StatusPanel
          action={<a href={submissionsHref}>Все сдачи</a>}
          icon={<CircleAlert aria-hidden="true" />}
          message="Сдача отсутствует или больше недоступна."
          state={{ "data-task-submissions-state": "not_found" }}
          title="Сдача не найдена"
        />
      ) : kind === "unauthorized" ? (
        <StatusPanel
          action={
            <form action="/auth/sign-in" method="post">
              <input name="returnTo" type="hidden" value={returnTo} />
              <Button type="submit">
                <LogIn aria-hidden="true" data-icon="inline-start" />
                Войти
              </Button>
            </form>
          }
          icon={<LogIn aria-hidden="true" />}
          message="Сдачи видит автор после входа."
          state={{ "data-task-submissions-state": "unauthorized" }}
          title="Нужен вход"
        />
      ) : kind === "forbidden" ? (
        <StatusPanel
          action={null}
          icon={<LockKeyhole aria-hidden="true" />}
          message="Сдачи открыты тем, кто управляет материалами: право materials:manage."
          state={{ "data-task-submissions-state": "forbidden" }}
          title="Нет доступа к сдачам"
        />
      ) : (
        <StatusPanel
          action={<RetryPageButton />}
          icon={<CircleAlert aria-hidden="true" />}
          message="Сдачи сейчас не загрузились. Попробуйте обновить страницу чуть позже."
          state={{ "data-task-submissions-state": "unavailable" }}
          title="Сдачи не загрузились"
        />
      )}
    </TaskSubmissionsFrame>
  );
}

export function TaskSubmissionsLoading() {
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
          <input disabled type="search" placeholder="Имя ученика или задание" />
        </label>
        <label className="submission-status-filter">
          <span className="sr-only">Результат проверки на этой странице</span>
          <select disabled>
            <option>Все результаты</option>
            <option>Самопроверка пройдена</option>
            <option>Нужны исправления</option>
            <option>Не хватает подтверждений</option>
            <option>Без самопроверки</option>
          </select>
        </label>
        <span className="course-filter-label">На этой странице: …</span>
      </search>
      <details className="submission-filter-more">
        <summary>Продукт, глава и задание</summary>
        <SubmissionFilter disabled products={[]} selection={{}} />
      </details>
      <div
        aria-busy="true"
        aria-label="Загружаем сдачи"
        className="grid gap-3"
        role="status"
        data-submissions-part="workspace"
      >
        <p className="text-sm text-muted-foreground">Загружаем сдачи…</p>
        {["first", "second", "third"].map((key) => (
          <div
            aria-hidden="true"
            className="h-24 rounded-xl bg-muted"
            key={key}
          />
        ))}
      </div>
    </TaskSubmissionsFrame>
  );
}
