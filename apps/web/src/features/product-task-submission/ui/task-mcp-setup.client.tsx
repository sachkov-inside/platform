"use client";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import styles from "./task-submission-workspace.module.css";
import { Button } from "@/shared/ui/button";

/** Fetch the canonical public instruction only when requested, without leaving the task. */
export function TaskMcpSetup({
  url,
  setupUrl,
  connectionPrompt,
}: {
  readonly url: string;
  readonly setupUrl: string;
  readonly connectionPrompt: string;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const setupInstructionFreshnessMs = 300_000;
  const [opened, setOpened] = useState(false);
  const [copyState, setCopyState] = useState("Скопировать запрос подключения");
  const instruction = useQuery({
    queryKey: ["learner-mcp-setup", setupUrl],
    enabled: opened,
    staleTime: setupInstructionFreshnessMs,
    queryFn: async ({ signal }) => {
      const result = await fetch("/practice-review-setup.txt", { signal });
      if (
        !result.ok ||
        result.headers.get("content-type")?.includes("text/plain") !== true
      )
        throw new Error("Setup unavailable");
      return result.text();
    },
    retry: false,
  });
  return (
    <div className={styles["stepContent"]} data-task-connection>
      <div className={styles["stepHeader"]}>
        <div className="grid gap-1">
          <h3 className="text-lg font-semibold">Подключение MCP</h3>
          <p className={styles["stepDescription"]}>
            Подключи один раз для всех заданий.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className={styles["stepToggle"]}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Скрыть инструкцию" : "Настроить подключение"}
          {expanded ? (
            <ChevronUp aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </Button>
      </div>
      <div id={contentId} hidden={!expanded}>
        <div className="grid gap-4 text-sm leading-6">
          <p>
            Один раз для всех заданий. Передай запрос агенту и подтверди вход в
            браузере тем же аккаунтом, что на сайте.
          </p>
          <div className="grid gap-5 rounded-xl bg-foreground p-6 text-card">
            <p className="whitespace-pre-line font-mono text-sm leading-6 [overflow-wrap:anywhere]">
              {connectionPrompt}
            </p>
            <Button
              type="button"
              aria-label={copyState}
              variant="outline"
              className="min-h-11 w-fit max-w-full whitespace-normal bg-card text-foreground hover:bg-card/90"
              onClick={() => {
                void navigator.clipboard
                  .writeText(connectionPrompt)
                  .then(() => {
                    setCopyState("Скопировано");
                  })
                  .catch(() => {
                    setCopyState(
                      "Не удалось скопировать — смотри инструкцию ниже",
                    );
                  });
              }}
            >
              <span role="status">{copyState}</span>
            </Button>
          </div>
          <p className="text-muted-foreground">
            Адрес MCP: <code className="break-all">{url}</code>
          </p>
          <details
            className={styles["setupHelp"]}
            onToggle={(event) => {
              setOpened(event.currentTarget.open);
            }}
          >
            <summary>
              <ChevronDown size={16} aria-hidden="true" />
              Подробная инструкция и помощь
            </summary>
            {instruction.data === undefined ? (
              instruction.isError ? (
                <div role="status">
                  <p>Инструкция не загрузилась.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void instruction.refetch();
                    }}
                  >
                    Повторить
                  </Button>
                </div>
              ) : (
                <p role="status">Загружаем инструкцию…</p>
              )
            ) : (
              <SetupInstructions text={instruction.data} />
            )}
          </details>
        </div>
      </div>
    </div>
  );
}

function SetupInstructions({ text }: { readonly text: string }) {
  const parts = text.split(/^--- (.+) ---$/gmu);
  return (
    <div className="grid gap-3">
      <p className="whitespace-pre-line text-sm leading-6">
        {parts[0]?.trim()}
      </p>
      {parts.flatMap((part, index) =>
        index % 2 === 0
          ? []
          : [
              <details key={part} className={styles["setupHelp"]}>
                <summary>
                  <ChevronDown size={16} aria-hidden="true" />
                  {part === "Проверка" ? "Проверка подключения и помощь" : part}
                </summary>
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-xs leading-6">
                  {parts[index + 1]?.trim()}
                </pre>
              </details>,
            ],
      )}
    </div>
  );
}
