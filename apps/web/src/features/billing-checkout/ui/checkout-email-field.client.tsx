"use client";
import { useId, type Ref } from "react";

export interface CheckoutEmailFieldProps {
  readonly value: string;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly onChange: (value: string) => void;
}

/** Email belongs to this order; payment never confirms a login identity. */
export function CheckoutEmailField({
  value,
  error,
  disabled,
  inputRef,
  onChange,
}: CheckoutEmailFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="mt-5">
      <label className="text-sm font-semibold" htmlFor={id}>
        Email для чека
      </label>
      <input
        aria-describedby={error === undefined ? helpId : `${helpId} ${errorId}`}
        aria-invalid={error !== undefined}
        autoCapitalize="none"
        autoComplete="email"
        className="mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm transition-colors focus:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        disabled={disabled}
        id={id}
        inputMode="email"
        maxLength={254}
        name="email"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        ref={inputRef}
        required
        spellCheck={false}
        type="email"
        value={value}
      />
      <p className="mt-2 text-sm leading-6 text-muted-foreground" id={helpId}>
        На этот адрес отправим чек и сообщения о покупке. Подтверждать кодом
        перед оплатой не нужно.
      </p>
      {error === undefined ? null : (
        <p
          className="mt-2 text-sm leading-6 text-destructive"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
