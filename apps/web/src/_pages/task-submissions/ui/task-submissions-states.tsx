import { CircleAlert, LockKeyhole, LogIn, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui/button";
import { StatusPanel } from "@/shared/ui/status-panel";

import { submissionsHref } from "../model/task-submissions";
import { TaskSubmissionsFrame } from "./task-submissions-view";

export function TaskSubmissionsState({
  kind,
}: {
  readonly kind: "unauthorized" | "forbidden" | "unavailable";
}) {
  return (
    <TaskSubmissionsFrame>
      {kind === "unauthorized" ? (
        <StatusPanel
          action={
            <form action="/auth/sign-in" method="post">
              <input name="returnTo" type="hidden" value={submissionsHref} />
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
          action={
            <Button asChild variant="outline">
              <Link href={submissionsHref}>
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                Обновить
              </Link>
            </Button>
          }
          icon={<CircleAlert aria-hidden="true" />}
          message="Сдачи сейчас не загрузились. Попробуйте обновить страницу чуть позже."
          state={{ "data-task-submissions-state": "unavailable" }}
          title="Сдачи не загрузились"
        />
      )}
    </TaskSubmissionsFrame>
  );
}
