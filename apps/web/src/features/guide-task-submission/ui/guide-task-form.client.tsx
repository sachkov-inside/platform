"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleCheck, RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

import { submitGuideTask } from "../api/submit-guide-task.browser";
import {
  SUBMISSION_NOTE_MAX_CHARACTERS,
  SUBMISSION_REPORT_MAX_CHARACTERS,
  SUBMISSION_REPOSITORY_MAX_CHARACTERS,
  type SubmitGuideTaskResult,
} from "../model/guide-task-submission";

const failures: Partial<Record<SubmitGuideTaskResult["kind"], string>> = {
  invalid_input:
    "Проверь поля: заметка обязательна, адрес репозитория начинается с http.",
  submissions_closed:
    "Приём сдач ещё не открыт. Сохрани заметку у себя и отправь позже.",
  task_not_available: "Задание сейчас закрыто для твоего аккаунта.",
  rate_limited:
    "За последний час сдач слишком много. Попробуй отправить позже.",
  unauthorized: "Сессия закончилась. Войди снова, заметка останется в форме.",
  unavailable: "Не удалось отправить сдачу. Попробуй ещё раз.",
};

/**
 * The fallback submission form of a task page (#947): a repository, a note and an optional report
 * as text. The learner never types a branch or a commit. A successful submission reloads the page,
 * so «Мои сдачи» shows it from the server.
 */
export function GuideTaskForm({
  accepting,
  code,
  taskVersion,
}: {
  /** The submission setting: closed until data policy v4 is published (#946). */
  readonly accepting: boolean;
  readonly code: string;
  readonly taskVersion: number;
}) {
  const id = useId();
  const router = useRouter();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [note, setNote] = useState("");
  const [reportText, setReportText] = useState("");
  // One key per content: a retry after a lost answer repeats it, an edit starts a new submission.
  const submissionKey = useRef<string | null>(null);
  const edit = (set: (value: string) => void) => (value: string) => {
    submissionKey.current = null;
    set(value);
  };
  const mutation = useMutation({
    mutationFn: () => {
      submissionKey.current ??= crypto.randomUUID();
      return submitGuideTask({
        code,
        taskVersion,
        submissionKey: submissionKey.current,
        note,
        repositoryUrl,
        reportText,
      });
    },
    onSuccess: (result) => {
      if (result.kind !== "submitted") return;
      submissionKey.current = null;
      setRepositoryUrl("");
      setNote("");
      setReportText("");
      router.refresh();
    },
  });
  const result = mutation.data;
  const failure =
    result === undefined || result.kind === "submitted"
      ? undefined
      : result.kind === "version_changed"
        ? "version_changed"
        : failures[result.kind];
  return (
    <form
      aria-describedby={`${id}-hint`}
      className="grid gap-4"
      data-guide-task-form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="text-sm leading-6 text-body-muted" id={`${id}-hint`}>
        Без агента отчёт проверки можно не прикладывать. Ветку и commit
        указывать не нужно.
      </p>
      {accepting ? null : (
        <p
          className="rounded-xl border border-[color-mix(in_srgb,var(--callout-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--callout-warning)_10%,transparent)] px-4 py-3 text-sm leading-6"
          role="status"
        >
          Приём сдач скоро откроется. Отправить сдачу пока нельзя.
        </p>
      )}
      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor={`${id}-repo`}
      >
        <span>
          Репозиторий{" "}
          <span className="font-normal text-muted-foreground">
            — необязательно
          </span>
        </span>
        <input
          autoComplete="url"
          className="min-h-11 rounded-lg border border-input bg-card px-3 font-normal"
          id={`${id}-repo`}
          inputMode="url"
          maxLength={SUBMISSION_REPOSITORY_MAX_CHARACTERS}
          name="repositoryUrl"
          onChange={(event) => {
            edit(setRepositoryUrl)(event.target.value);
          }}
          placeholder="https://github.com/…"
          type="url"
          value={repositoryUrl}
        />
      </label>
      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor={`${id}-note`}
      >
        Заметка для автора
        <span
          className="font-normal text-muted-foreground"
          id={`${id}-note-hint`}
        >
          5–7 строк: что сделано, какие решения принял, в чём не уверен.
        </span>
        <textarea
          aria-describedby={`${id}-note-hint`}
          className="min-h-36 rounded-lg border border-input bg-card px-3 py-2 font-normal leading-6"
          id={`${id}-note`}
          maxLength={SUBMISSION_NOTE_MAX_CHARACTERS}
          name="note"
          onChange={(event) => {
            edit(setNote)(event.target.value);
          }}
          required
          value={note}
        />
        <span
          aria-hidden="true"
          className="justify-self-end text-xs font-normal tabular-nums text-muted-foreground"
        >
          {note.length} / {SUBMISSION_NOTE_MAX_CHARACTERS}
        </span>
      </label>
      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor={`${id}-report`}
      >
        <span>
          Отчёт проверки{" "}
          <span className="font-normal text-muted-foreground">
            — необязательно, текстом
          </span>
        </span>
        <textarea
          className="min-h-24 rounded-lg border border-input bg-card px-3 py-2 font-normal leading-6"
          id={`${id}-report`}
          maxLength={SUBMISSION_REPORT_MAX_CHARACTERS}
          name="reportText"
          onChange={(event) => {
            edit(setReportText)(event.target.value);
          }}
          value={reportText}
        />
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          className="min-h-11"
          disabled={!accepting || mutation.isPending}
          type="submit"
        >
          <Send aria-hidden="true" />
          {mutation.isPending ? "Отправляем…" : "Отправить сдачу"}
        </Button>
        <p className="min-w-0 text-sm leading-6" role="status">
          {result?.kind === "submitted" ? (
            <span className="inline-flex items-center gap-1.5 text-[color:var(--callout-good)]">
              <CircleCheck aria-hidden="true" className="size-4" />
              Сдача отправлена. Она появилась в «Моих сдачах».
            </span>
          ) : null}
        </p>
      </div>
      {failure === undefined ? null : failure === "version_changed" ? (
        <div
          className="grid justify-items-start gap-2 text-sm leading-6"
          role="alert"
        >
          <p>
            Требования задания обновились, пока страница была открыта. Обнови
            страницу и проверь работу по новой версии.
          </p>
          <Button
            className="min-h-11"
            onClick={() => {
              router.refresh();
            }}
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" />
            Обновить страницу
          </Button>
        </div>
      ) : (
        <p className="text-sm leading-6 text-destructive" role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}
