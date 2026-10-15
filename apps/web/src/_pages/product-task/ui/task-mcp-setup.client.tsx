"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { learnerMcpConnectPrompt } from "@/features/learner-mcp";
import { Button } from "@/shared/ui/button";

/** Fetch the canonical public instruction only when requested, without leaving the task. */
export function TaskMcpSetup({
  url,
  setupUrl,
}: {
  readonly url: string;
  readonly setupUrl: string;
}) {
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
    <details className="group border-t border-border pt-3" data-task-connection>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
        Подключить учебный MCP
      </summary>
      <div className="grid gap-4 pb-3 text-sm leading-6">
        <p>
          Один раз для всех заданий. Передай запрос агенту и подтверди вход в
          браузере тем же аккаунтом, что на сайте.
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit max-w-full whitespace-normal"
          onClick={() => {
            void navigator.clipboard
              .writeText(
                learnerMcpConnectPrompt(
                  new URL(setupUrl, window.location.origin).href,
                ),
              )
              .then(() => {
                setCopyState("Скопировано");
              })
              .catch(() => {
                setCopyState("Не удалось скопировать — смотри инструкцию ниже");
              });
          }}
        >
          <span role="status">{copyState}</span>
        </Button>
        <p className="text-muted-foreground">
          Адрес MCP: <code className="break-all">{url}</code>
        </p>
        <details
          onToggle={(event) => {
            setOpened(event.currentTarget.open);
          }}
        >
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
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
    </details>
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
              <details key={part} className="border-t border-border pt-2">
                <summary className="min-h-11 cursor-pointer py-2 font-medium">
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
