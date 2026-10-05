import { MaterialAgentPrompt } from "@/entities/material";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import {
  practiceReviewPrompt,
  type LearningPracticesView,
} from "../model/learning-practice";
import type { LearnerMcpConnection } from "../model/practice-review-setup";

/**
 * Public lessons retain their prefetched body; only an explicit disclosure expands this row. The
 * prefetched fallback has no result and no connection: configuration is read per request.
 */
export function LearningPracticeDisclosure(
  props:
    | { readonly result: null }
    | {
        readonly connection: LearnerMcpConnection;
        readonly result: LearningPracticesView;
      },
) {
  return (
    <div className="mt-8 min-h-11" data-practice-slot>
      {props.result === null ? (
        <p
          className="flex h-11 items-center text-sm text-muted-foreground"
          role="status"
        >
          Проверяем доступность заданий…
        </p>
      ) : props.result.kind === "available" &&
        props.result.practices.length === 0 ? null : (
        <details>
          <summary className="flex h-11 cursor-pointer items-center font-semibold underline underline-offset-4">
            Открыть проверку практики
          </summary>
          <LearningPracticePrompts
            connection={props.connection}
            result={props.result}
          />
        </details>
      )}
    </div>
  );
}

/** Reuses the production Reader prompt block; there is no second grading interface. */
export function LearningPracticePrompts({
  connection,
  result,
}: {
  readonly connection: LearnerMcpConnection;
  readonly result: LearningPracticesView;
}) {
  if (result.kind === "unavailable")
    return (
      <div className="mt-8" role="status">
        <p>Задания для проверки сейчас недоступны.</p>
        <RetryPageButton />
      </div>
    );
  if (result.practices.length === 0) return null;
  return (
    <section className="mt-10" aria-label="Проверка практики">
      <h2 className="text-xl font-semibold">Проверка практики</h2>
      <p className="mt-3 text-muted-foreground">
        Открой отдельную сессию своего агента в режиме проверки и передай ему
        запрос. Агент разберёт готовый результат; исправления ты внесёшь
        отдельно.
      </p>
      <details className="mt-5 rounded-xl border p-5">
        <summary className="cursor-pointer font-semibold">
          Настройка проверки
        </summary>
        <p className="mt-3">
          Адрес учебного MCP:{" "}
          <code className="break-all">{connection.url}</code>
        </p>
        <p className="mt-3 text-muted-foreground">
          Добавьте этот адрес в своём агенте как MCP-сервер по HTTP: подойдёт
          Codex, Claude Code, OpenCode или другой агент с поддержкой MCP. Агент
          откроет страницу входа: войдите тем же аккаунтом, что и на сайте.
          Токен вручную вводить не нужно.
        </p>
        <p className="mt-3">
          <a
            className="underline underline-offset-4"
            href="/practice-review-setup.txt"
            target="_blank"
            rel="noreferrer"
          >
            Открыть инструкцию подключения
          </a>
        </p>
        <p className="mt-3 text-muted-foreground">
          Проверку запускайте в отдельной сессии агента: ему нужны чтение
          проекта и учебный MCP. Исправления делайте в другой сессии.
        </p>
      </details>
      {result.practices.map((practice) => (
        <MaterialAgentPrompt
          key={practice.practiceId}
          title={practice.title}
          text={practiceReviewPrompt(practice)}
        />
      ))}
    </section>
  );
}
