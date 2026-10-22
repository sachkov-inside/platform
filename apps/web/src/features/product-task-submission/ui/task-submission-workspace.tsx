import { productTaskAgentPhrase } from "@/entities/product-task";
import { cn } from "@/shared/lib/utils";
import { TaskMcpSetup } from "./task-mcp-setup.client";
import { TaskSubmissionHistory } from "./task-submission-history.client";
import { AgentPhrase } from "./agent-phrase.client";
import type { OwnSubmissionsView } from "../model/product-task-page";
import styles from "./task-submission-workspace.module.css";

export interface TaskSubmissionWorkspaceProps {
  readonly code: string;
  readonly version: number;
  readonly accepting: boolean;
  readonly history: OwnSubmissionsView;
  readonly learnerMcpUrl: string;
  readonly connectionPrompt: string;
  readonly learnerMcpSetupUrl?: string;
  readonly liveSubmissions?: boolean;
  readonly attemptsAfter?: string | undefined;
  readonly accountId?: string | null;
  readonly returnTo: string;
  readonly conflictingAnchorIds?: readonly string[];
}

/** One submission workflow shared by standalone Tasks and practical Materials. */
export function TaskSubmissionWorkspace({
  code,
  version,
  accepting,
  history,
  learnerMcpUrl,
  connectionPrompt,
  learnerMcpSetupUrl = "/practice-review-setup.txt",
  liveSubmissions = true,
  attemptsAfter,
  accountId = null,
  returnTo,
  conflictingAnchorIds = [],
}: TaskSubmissionWorkspaceProps) {
  const anchor = (id: string) =>
    conflictingAnchorIds.includes(id) ? `${id}:page` : id;
  return (
    <section
      className={styles["workspace"]}
      id={anchor("task-submit")}
      aria-labelledby={anchor("task-submit-heading")}
    >
      <header className="grid gap-3">
        <h2
          className="text-2xl font-semibold tracking-tight"
          id={anchor("task-submit-heading")}
        >
          Сдача задания
        </h2>
        <p className="text-sm leading-6 text-body-muted">
          Агент проверяет проект. Просто следуй шагам ниже.
        </p>
      </header>
      <ol className={styles["roadmap"]}>
        <li className={styles["step"]}>
          <span className={styles["stepNumber"]} aria-hidden="true">
            1
          </span>
          <TaskMcpSetup
            url={learnerMcpUrl}
            setupUrl={learnerMcpSetupUrl}
            connectionPrompt={connectionPrompt}
          />
        </li>
        <li className={styles["step"]}>
          <span className={styles["stepNumber"]} aria-hidden="true">
            2
          </span>
          <div className={styles["stepContent"]}>
            <h3 className="text-lg font-semibold">Проверка задания</h3>
            <p className={styles["stepDescription"]}>
              Скопируй запрос в новую сессию агента в папке проекта. Агент
              проверит работу, покажет отчёт и попросит подтвердить отправку.
            </p>
            <AgentPhrase text={productTaskAgentPhrase(code)} />
            {accepting ? null : (
              <p role="status" className="text-sm leading-6">
                Приём сдач скоро откроется. Проверить работу у агента уже можно.
              </p>
            )}
          </div>
        </li>
        <li className={styles["step"]}>
          <span
            className={cn(styles["stepNumber"], styles["resultStep"])}
            aria-hidden="true"
          >
            3
          </span>
          <div className={styles["stepContent"]}>
            <h3 className="text-lg font-semibold">Результат проверки</h3>
            <p className={styles["stepDescription"]}>
              Здесь появляются сообщения от агента и результаты проверки.
            </p>
            <section
              className={styles["history"]}
              id={anchor("task-mine")}
              aria-labelledby={anchor("task-mine-heading")}
            >
              <h4 className="sr-only" id={anchor("task-mine-heading")}>
                Мои сдачи
              </h4>
              <TaskSubmissionHistory
                initial={history}
                code={code}
                currentVersion={version}
                returnTo={returnTo}
                historyAnchor={anchor("task-mine")}
                live={liveSubmissions}
                after={attemptsAfter}
                accountId={accountId}
                key={
                  history.kind === "ready"
                    ? (history.latestSubmittedAt ?? "empty")
                    : history.kind
                }
              />
            </section>
          </div>
        </li>
      </ol>
    </section>
  );
}
