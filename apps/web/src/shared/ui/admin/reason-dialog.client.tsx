"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type SubmitEvent,
  type ReactNode,
} from "react";

import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

import "./admin.css";

export interface ReasonOption {
  readonly value: string;
  readonly label: string;
}

export interface ReasonDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** Что изменится после подтверждения. */
  readonly consequence?: ReactNode;
  readonly reasons: readonly ReasonOption[];
  /** Причина «Другое»: с ней заметка обязательна. */
  readonly otherValue?: string;
  readonly noteLabel?: string;
  readonly noteMaxLength?: number;
  /** Кнопка называет результат: «Отозвать доступ». */
  readonly confirmLabel: string;
  readonly tone?: "default" | "danger";
  readonly pending?: boolean;
  /** Ошибка последней попытки: диалог остаётся открытым и показывает её. */
  readonly error?: string | null;
  readonly onConfirm: (input: {
    readonly reason: string;
    readonly note: string;
  }) => void;
}

/**
 * Модальный диалог действия с причиной: выбор причины, заметка и кнопка, которая называет итог.
 * Проверка идёт при отправке; после первой попытки поля перепроверяются при вводе. У опасного
 * действия фокус начинается на «Отмена». Пока действие выполняется, Escape диалог не закрывает.
 */
export function ReasonDialog(props: ReasonDialogProps) {
  const { open, onOpenChange, pending = false, consequence } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  // Синхронизация с модальным слоем браузера: `showModal` и `close` принадлежат элементу. Эффект
  // разметки идёт раньше обычных эффектов формы, поэтому её первый фокус ставится уже в модальном слое.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={
        consequence === undefined ? undefined : `${id}-consequence`
      }
      aria-labelledby={`${id}-heading`}
      className="admin-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onOpenChange(false);
      }}
      onClose={(event) => {
        // Событие close приходит задачей позже: к этому времени диалог могли уже открыть снова.
        if (open && !event.currentTarget.open) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        // Escape обрабатывается здесь, а не только событием cancel: так он одинаково работает
        // во всех браузерах и не закрывает диалог посреди выполнения.
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (!pending) onOpenChange(false);
      }}
      ref={dialog}
    >
      {open ? <ReasonForm {...props} dialogId={id} /> : null}
    </dialog>
  );
}

function ReasonForm({
  dialogId,
  onOpenChange,
  title,
  consequence,
  reasons,
  otherValue,
  noteLabel = "Комментарий",
  noteMaxLength = 500,
  confirmLabel,
  tone = "default",
  pending = false,
  error = null,
  onConfirm,
}: ReasonDialogProps & { readonly dialogId: string }) {
  const id = dialogId;
  const headingId = `${id}-heading`;
  const consequenceId = `${id}-consequence`;
  const legendId = `${id}-reason-legend`;
  const reasonErrorId = `${id}-reason-error`;
  const noteId = `${id}-note`;
  const noteErrorId = `${id}-note-error`;
  const cancel = useRef<HTMLButtonElement>(null);
  const firstReason = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const noteRequired = otherValue !== undefined && reason === otherValue;
  const reasonError = reason === "" ? "Выберите причину" : null;
  const noteError =
    noteRequired && noteText.trim() === "" ? "Опишите причину" : null;
  const shownReasonError = submitted ? reasonError : null;
  const shownNoteError = submitted ? noteError : null;

  // Первый фокус после `showModal`: у опасного действия это безопасная «Отмена».
  useEffect(() => {
    if (tone === "danger") cancel.current?.focus();
    else firstReason.current?.focus();
  }, [tone]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (reasonError !== null) {
      firstReason.current?.focus();
      return;
    }
    if (noteError !== null) {
      note.current?.focus();
      return;
    }
    onConfirm({ reason, note: noteText.trim() });
  };

  return (
    <form className="admin-dialog-body" noValidate onSubmit={submit}>
      <div>
        <h2 id={headingId}>{title}</h2>
        {consequence === undefined ? null : (
          <div className="admin-dialog-consequence" id={consequenceId}>
            {consequence}
          </div>
        )}
      </div>
      {hasText(error) ? (
        <div className="admin-dialog-banner" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      <fieldset
        aria-describedby={shownReasonError === null ? undefined : reasonErrorId}
        aria-invalid={shownReasonError !== null}
        aria-labelledby={legendId}
        aria-required="true"
        className="admin-reasons"
        disabled={pending}
        role="radiogroup"
      >
        <legend id={legendId}>Причина</legend>
        {reasons.map((option, index) => (
          <label className="admin-reason" key={option.value}>
            <input
              checked={reason === option.value}
              name={`${id}-reason`}
              onChange={() => {
                setReason(option.value);
              }}
              ref={index === 0 ? firstReason : undefined}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
        {shownReasonError === null ? null : (
          <FieldError id={reasonErrorId}>{shownReasonError}</FieldError>
        )}
      </fieldset>
      <div className="admin-field">
        <label className="admin-field-label" htmlFor={noteId}>
          {noteLabel}
          {noteRequired ? null : (
            <span className="font-normal text-muted-foreground">
              {" "}
              (необязательно)
            </span>
          )}
        </label>
        <textarea
          aria-describedby={shownNoteError === null ? undefined : noteErrorId}
          aria-invalid={shownNoteError !== null}
          className="admin-field-textarea"
          disabled={pending}
          id={noteId}
          maxLength={noteMaxLength}
          onChange={(event) => {
            setNoteText(event.currentTarget.value);
          }}
          ref={note}
          required={noteRequired}
          value={noteText}
        />
        {shownNoteError === null ? null : (
          <FieldError id={noteErrorId}>{shownNoteError}</FieldError>
        )}
      </div>
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          disabled={pending}
          onClick={() => {
            onOpenChange(false);
          }}
          ref={cancel}
          type="button"
          variant="outline"
        >
          Отмена
        </Button>
        <Button
          aria-busy={pending}
          className="min-h-11 px-4"
          disabled={pending}
          type="submit"
          variant={tone === "danger" ? "destructive" : "default"}
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

function FieldError({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <p className="admin-field-error" id={id}>
      <CircleAlert aria-hidden="true" />
      {children}
    </p>
  );
}
