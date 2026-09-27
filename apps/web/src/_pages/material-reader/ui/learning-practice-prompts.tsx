import { MaterialAgentPrompt } from "@/entities/material";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import {
  practiceReviewPrompt,
  type LearningPracticesView,
} from "../model/learning-practice";

/** Public lessons retain their prefetched body; only an explicit disclosure expands this row. */
export function LearningPracticeDisclosure({
  result,
}: {
  readonly result: LearningPracticesView | null;
}) {
  return (
    <div className="mt-8 min-h-11" data-practice-slot>
      {result === null ? (
        <p
          className="flex h-11 items-center text-sm text-muted-foreground"
          role="status"
        >
          Проверяем доступность заданий…
        </p>
      ) : result.kind === "available" &&
        result.practices.length === 0 ? null : (
        <details>
          <summary className="flex h-11 cursor-pointer items-center font-semibold underline underline-offset-4">
            Открыть проверку практики
          </summary>
          <LearningPracticePrompts result={result} />
        </details>
      )}
    </div>
  );
}

/** Reuses the production Reader prompt block; there is no second grading interface. */
export function LearningPracticePrompts({
  result,
}: {
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
        <p className="mt-3 text-muted-foreground">
          Для первого подключения нужен адрес учебного MCP от автора курса. Если
          адрес ещё не выдан или вход не проходит, обратитесь к автору; после
          подключения вернитесь к запросу ниже. Входите своим аккаунтом
          участника. Авторский MCP для проверки не нужен.
        </p>
        <p className="mt-3">
          <a
            className="underline underline-offset-4"
            href="/practice-review-setup.txt"
            target="_blank"
            rel="noreferrer"
          >
            Открыть команды подключения и запуска
          </a>
        </p>
        <h3 className="mt-5 font-semibold" id="practice-review-codex">
          Codex
        </h3>
        <p className="mt-2">
          Подключите учебный сервер через настройки MCP и выполните OAuth-вход.
          Откройте отдельную сессию в каталоге своего проекта: sandbox{" "}
          <code>read-only</code>, подтверждения <code>never</code>. Используйте
          профиль без project rules, hooks, plugins, других MCP и дополнительных
          агентов. Для команд чтения не запускайте код, тесты или скрипты
          проекта.
        </p>
        <h3 className="mt-5 font-semibold" id="practice-review-claude-code">
          Claude Code
        </h3>
        <p className="mt-2">
          Подключите учебный сервер как HTTP MCP и выполните OAuth-вход. Для
          отдельной проверяющей сессии оставьте файловые инструменты{" "}
          <code>Read, Glob, Grep</code> и только учебный MCP; отключите Bash,
          Write, Edit, Agent, hooks и дополнительные подключения. Сам по себе
          Plan mode не задаёт эти ограничения.
        </p>
        <p className="mt-3 text-muted-foreground">
          Перед проверкой убедитесь, что доступны только чтение проекта и
          учебные инструменты. Исправления делайте в другой сессии. Если
          используемый клиент или настройки отличаются от проверенного профиля,
          сначала уточните настройку у автора курса.
        </p>
      </details>
      {result.practices.map((practice) => (
        <div key={practice.practiceId}>
          <MaterialAgentPrompt
            title={`${practice.title} · Codex`}
            text={practiceReviewPrompt(practice, "Codex")}
          />
          <MaterialAgentPrompt
            title={`${practice.title} · Claude Code`}
            text={practiceReviewPrompt(practice, "Claude Code")}
          />
        </div>
      ))}
    </section>
  );
}
