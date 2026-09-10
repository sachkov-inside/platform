"use client";
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import {
  accessCapabilitySchema,
  type AccessCapability,
} from "@/entities/subscription";

/** Общая разметка владельческой формы: плотная, без декоративных карточек. */
export function AdminSection({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <h2 className="text-xl font-semibold tracking-[-0.02em]">{title}</h2>
      {description === undefined ? null : (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      <div className="mt-4 grid gap-5">{children}</div>
    </section>
  );
}

export function AdminField({
  label,
  name,
  hint,
  ...rest
}: {
  readonly label: string;
  readonly name: string;
  readonly hint?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = `admin-${name}`;
  return (
    <p className="grid gap-1">
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <input
        className="min-h-11 w-full rounded-xl border border-input bg-background px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        id={id}
        name={name}
        {...rest}
      />
      {hint === undefined ? null : (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </p>
  );
}

export function AdminTextArea({
  label,
  name,
  hint,
  ...rest
}: {
  readonly label: string;
  readonly name: string;
  readonly hint?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = `admin-${name}`;
  return (
    <p className="grid gap-1">
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <textarea
        className="min-h-24 w-full rounded-xl border border-input bg-background p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        id={id}
        name={name}
        {...rest}
      />
      {hint === undefined ? null : (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </p>
  );
}

export function AdminSelect({
  label,
  name,
  options,
}: {
  readonly label: string;
  readonly name: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}) {
  const id = `admin-${name}`;
  return (
    <p className="grid gap-1">
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <select
        className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        id={id}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </p>
  );
}

export interface ParsedCapabilities {
  readonly capabilities: readonly AccessCapability[];
  readonly periods: readonly {
    readonly capability: AccessCapability;
    readonly months: number | null;
  }[];
  /** Записи, которых нет в принятом наборе прав: их нельзя отправлять командой. */
  readonly invalid: readonly string[];
}

/**
 * Строки состава прав: `capability`, `capability=12` или `capability=null` для бессрочного.
 * Право проверяется тем же закрытым набором, что и на сервере, поэтому опечатка видна в форме.
 */
export function parseCapabilities(value: string): ParsedCapabilities {
  const capabilities: AccessCapability[] = [];
  const periods: { capability: AccessCapability; months: number | null }[] = [];
  const invalid: string[] = [];
  for (const line of value.split(/[\n,]/u)) {
    const entry = line.trim();
    if (entry.length === 0) continue;
    const [name = "", months] = entry.split("=", 2);
    const parsed = accessCapabilitySchema.safeParse(name.trim());
    if (!parsed.success) {
      invalid.push(entry);
      continue;
    }
    capabilities.push(parsed.data);
    if (months === undefined) continue;
    const term = months.trim();
    periods.push({
      capability: parsed.data,
      months: term === "null" || term === "" ? null : Number(term),
    });
  }
  return { capabilities, periods, invalid };
}

export const capabilityHint =
  "Известные права: materials, community, reviews, support и guide:<uuid>.";

export function optionalFormNumber(
  value: FormDataEntryValue | null,
): number | undefined {
  const entry = formText(value);
  return entry.length === 0 ? undefined : Number(entry);
}

export function optionalFormText(
  value: FormDataEntryValue | null,
): string | undefined {
  const entry = formText(value);
  return entry.length === 0 ? undefined : entry;
}

export function formText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}
