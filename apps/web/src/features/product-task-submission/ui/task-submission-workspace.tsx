import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { productTaskAgentPhrase } from "@/entities/product-task";
import { Button } from "@/shared/ui/button";
import { ProductTaskForm } from "./product-task-form.client";
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
          Агент проверяет проект. Здесь — подключение, начало проверки и её
          результат.
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
            <h3 className="text-lg font-semibold">Начало проверки</h3>
            <p className={styles["stepDescription"]}>
              Открой новую сессию агента в папке проекта, где ты выполнил
              задание.
            </p>
            <p className="text-sm leading-6">
              Передай запрос в новой сессии. Агент проверит работу, покажет
              отчёт и попросит подтвердить отправку.
            </p>
            <AgentPhrase text={productTaskAgentPhrase(code)} />
            <p className={styles["stepDescription"]}>
              Работай и обсуждай замечания у агента. Здесь появятся статус
              проверки и краткий отчёт.
            </p>
            {accepting ? null : (
              <p role="status" className="text-sm leading-6">
                Приём сдач скоро откроется. Проверить работу у агента уже можно.
              </p>
            )}
          </div>
        </li>
        <li className={styles["step"]}>
          <span className={styles["stepNumber"]} aria-hidden="true">
            3
          </span>
          <div className={styles["stepContent"]}>
            <h3 className="text-lg font-semibold">
              Результат и обратная связь
            </h3>
            <p className={styles["stepDescription"]}>
              Статус проверки, твои сдачи и ответ автора — в одном месте.
            </p>
            <section
              className={styles["history"]}
              id={anchor("task-mine")}
              aria-labelledby={anchor("task-mine-heading")}
            >
              <h4
                className="text-sm font-semibold"
                id={anchor("task-mine-heading")}
              >
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
      <Disclosure
        title="Нет агента с MCP? Сдать через форму"
        dataAttribute="fallback-form"
      >
        {history.kind === "guest" ? (
          <SignIn
            explanation="Войди, чтобы отправить сдачу."
            returnTo={returnTo}
          />
        ) : (
          <ProductTaskForm
            accepting={accepting}
            code={code}
            taskVersion={version}
          />
        )}
      </Disclosure>
    </section>
  );
}

function Disclosure({
  children,
  className = "",
  dataAttribute,
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly dataAttribute?: string;
  readonly title: string;
}) {
  return (
    <details
      className={`group rounded-xl border border-border ${className}`}
      data-task-disclosure={dataAttribute}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="px-4 pb-4 text-base">{children}</div>
    </details>
  );
}

function SignIn({
  explanation,
  returnTo,
}: {
  readonly explanation: string;
  readonly returnTo: string;
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-sm leading-6 text-body-muted">{explanation}</p>
      <form action="/auth/sign-in" method="post">
        <input name="returnTo" type="hidden" value={returnTo} />
        <Button className="min-h-11" type="submit" variant="outline">
          Войти через Telegram
        </Button>
      </form>
    </div>
  );
}
