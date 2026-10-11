import { CircleAlert, LockKeyhole, LogIn } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import { StatusPanel } from "@/shared/ui/status-panel";

import { submissionsHref } from "../model/task-submissions";
import { TaskSubmissionsFrame } from "./task-submissions-view";

export function TaskSubmissionsState({
  kind,
  returnTo = submissionsHref,
}: {
  readonly kind: "unauthorized" | "forbidden" | "unavailable";
  /** The filtered address to come back to after sign-in. */
  readonly returnTo?: string;
}) {
  return (
    <TaskSubmissionsFrame>
      {kind === "unauthorized" ? (
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
      <div
        aria-busy="true"
        aria-label="Загружаем сдачи"
        className="grid gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]"
        role="status"
      >
        <div className="grid content-start gap-3">
          <p className="text-sm text-muted-foreground">Загружаем сдачи…</p>
          {["first", "second", "third"].map((key) => (
            <div
              aria-hidden="true"
              className="h-24 rounded-xl bg-muted"
              key={key}
            />
          ))}
        </div>
        <div aria-hidden="true" className="grid content-start gap-6">
          <div className="h-32 rounded-xl bg-muted" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      </div>
    </TaskSubmissionsFrame>
  );
}
