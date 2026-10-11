"use client";

import { ClipboardCheck, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { MaterialAgentPrompt } from "@/entities/material";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import {
  practiceReviewPrompt,
  type LearningPracticesView,
} from "../model/learning-practice";
import {
  learnerMcpConnectPrompt,
  type ReaderLearnerMcp,
} from "../model/practice-review-setup";

/**
 * Public lessons retain their prefetched body. The practice control shares the existing action
 * row; only opening its disclosure adds height. The fallback contains no private result.
 */
export function LearningPracticeDisclosure(
  props:
    | { readonly result: null }
    | {
        readonly connection: ReaderLearnerMcp;
        readonly result: LearningPracticesView;
      },
) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (props.result?.kind === "available" && props.result.practices.length === 0)
    return (
      <span
        aria-hidden="true"
        className="size-11 shrink-0"
        data-practice-empty
      />
    );
  if (props.result === null)
    return (
      <span
        className="grid size-11 shrink-0 place-items-center"
        data-practice-loading
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        <span role="status" className="sr-only">
          Проверяем доступность заданий…
        </span>
      </span>
    );
  return (
    <>
      <button
        type="button"
        aria-label="Открыть проверку практики"
        aria-expanded={expanded}
        aria-controls={contentId}
        title="Открыть проверку практики"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-ring"
        data-practice-summary
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        <ClipboardCheck aria-hidden="true" className="size-5" />
      </button>
      <div
        id={contentId}
        hidden={!expanded}
        className="order-last w-full min-w-0 basis-full"
      >
        <LearningPracticePrompts
          connection={props.connection}
          result={props.result}
        />
      </div>
    </>
  );
}

/** Reuses the production Reader prompt block; there is no second grading interface. */
export function LearningPracticePrompts({
  connection,
  result,
}: {
  readonly connection: ReaderLearnerMcp;
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
          Подключение делается один раз. Скопируй запрос ниже и отправь его
          своему агенту: Codex, Claude Code, OpenCode или другому агенту с
          поддержкой MCP. Агент добавит сервер сам. Тебе останется войти в
          браузере тем же аккаунтом, что и на сайте, нажать «Разрешить» и
          открыть новую сессию агента.
        </p>
        <MaterialAgentPrompt
          title="Подключить агента"
          text={learnerMcpConnectPrompt(connection.setupUrl)}
        />
        <p className="mt-3">
          <a
            className="underline underline-offset-4"
            href="/practice-review-setup.txt"
            target="_blank"
            rel="noreferrer"
          >
            Открыть инструкцию для ручного подключения
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
