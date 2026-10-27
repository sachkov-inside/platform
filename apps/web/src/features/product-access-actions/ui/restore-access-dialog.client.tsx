"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import { Button } from "@/shared/ui/button";

import {
  ACCESS_REASON_MAX_CHARACTERS,
  encodeRestoreReason,
} from "../model/access-reasons";
import {
  AccessDialog,
  AccessDialogError,
  AccessFieldError,
} from "./access-dialog.client";

export interface RestoreAccessDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly productName: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onConfirm: (reason: string) => void;
}

/**
 * «Восстановить» (#1721): короткая форма с причиной без предупреждения о последствиях. Доступ
 * возвращается сразу, карточка подтверждает это уведомлением.
 */
export function RestoreAccessDialog(props: RestoreAccessDialogProps) {
  const headingId = useId();
  return (
    <AccessDialog
      labelledBy={headingId}
      onOpenChange={props.onOpenChange}
      open={props.open}
      pending={props.pending}
    >
      <RestoreForm {...props} headingId={headingId} />
    </AccessDialog>
  );
}

function RestoreForm({
  error,
  headingId,
  onConfirm,
  onOpenChange,
  pending,
  productName,
}: RestoreAccessDialogProps & { readonly headingId: string }) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const encoded = encodeRestoreReason(text);
  const shownError = submitted && !encoded.ok ? "Напишите причину" : null;
  const fieldId = `${id}-reason`;
  const errorId = `${id}-reason-error`;

  useEffect(() => {
    field.current?.focus();
  }, []);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (!encoded.ok) {
      field.current?.focus();
      return;
    }
    onConfirm(encoded.text);
  };

  return (
    <form className="admin-dialog-body" noValidate onSubmit={submit}>
      <h2 id={headingId}>Восстановить доступ к «{productName}»</h2>
      <AccessDialogError message={error} />
      <div className="admin-field">
        <label className="admin-field-label" htmlFor={fieldId}>
          Причина
        </label>
        <textarea
          aria-describedby={shownError === null ? undefined : errorId}
          aria-invalid={shownError !== null}
          className="admin-field-textarea"
          disabled={pending}
          id={fieldId}
          maxLength={ACCESS_REASON_MAX_CHARACTERS}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
          ref={field}
          required
          value={text}
        />
        {shownError === null ? null : (
          <AccessFieldError id={errorId}>{shownError}</AccessFieldError>
        )}
      </div>
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          disabled={pending}
          onClick={() => {
            onOpenChange(false);
          }}
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
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          Восстановить доступ
        </Button>
      </div>
    </form>
  );
}
