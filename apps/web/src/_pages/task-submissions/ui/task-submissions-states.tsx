import { LockKeyhole, LogIn } from "lucide-react";

import { internalRoute } from "@/shared/routing/internal-route";
import {
  AdminErrorState,
  AdminNotFound,
  AdminTableSkeleton,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import { StatusPanel } from "@/shared/ui/status-panel";

import {
  defaultFeedbackFilter,
  submissionsHref,
} from "../model/task-submissions";
import { SubmissionFilters } from "./submission-filters.client";
import { TaskSubmissionsFrame } from "./task-submissions-view.client";

export function TaskSubmissionsState({
  kind,
  returnTo = submissionsHref,
  listHref = submissionsHref,
}: {
  readonly kind: "unauthorized" | "forbidden" | "unavailable" | "not_found";
  /** The filtered address to come back to after sign-in. */
  readonly returnTo?: string;
  readonly listHref?: string;
}) {
  return (
    <TaskSubmissionsFrame>
      {kind === "not_found" ? (
        <div data-task-submissions-state="not_found">
          <AdminNotFound
            backHref={internalRoute(listHref)}
            backLabel="Все сдачи"
            description="Сдача отсутствует или больше недоступна."
            title="Сдача не найдена"
          />
        </div>
      ) : kind === "unauthorized" ? (
        <StatusPanel
          action={
            <form action="/auth/sign-in" method="post">
              <input name="returnTo" type="hidden" value={returnTo} />
              <Button type="submit">
                <LogIn aria-hidden="true" data-icon="inline-start" />
                Войти через Telegram
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
        <div data-task-submissions-state="unavailable">
          <AdminErrorState
            description="Сдачи сейчас не загрузились. Попробуйте обновить страницу чуть позже."
            retry={<RetryPageButton />}
            title="Сдачи не загрузились"
          />
        </div>
      )}
    </TaskSubmissionsFrame>
  );
}

/**
 * The route skeleton in the frame of the default view: the same header, filter bar and table
 * geometry, so the arriving list moves nothing. The filters already work while the list loads.
 */
export function TaskSubmissionsLoading() {
  return (
    <TaskSubmissionsFrame>
      <SubmissionFilters
        feedback={defaultFeedbackFilter}
        products={[]}
        selection={{}}
      />
      <section
        aria-busy="true"
        aria-label="Загружаем сдачи"
        data-submissions-part="workspace"
      >
        <AdminTableSkeleton columns={5} label="Загружаем сдачи" />
      </section>
    </TaskSubmissionsFrame>
  );
}
