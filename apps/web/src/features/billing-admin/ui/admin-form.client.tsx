"use client";
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

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

export function Field({
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

export function AreaField({
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

export function SelectField({
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

/** Строки состава прав: `capability`, `capability=12` или `capability=null` для бессрочного. */
export function parseBenefits(value: string): {
  readonly benefits: readonly string[];
  readonly benefitPeriods: readonly {
    readonly capability: string;
    readonly months: number | null;
  }[];
} {
  const benefits: string[] = [];
  const benefitPeriods: { capability: string; months: number | null }[] = [];
  for (const line of value.split(/[\n,]/u)) {
    const entry = line.trim();
    if (entry.length === 0) continue;
    const [capability = "", months] = entry.split("=", 2);
    const name = capability.trim();
    if (name.length === 0) continue;
    benefits.push(name);
    if (months === undefined) continue;
    const term = months.trim();
    benefitPeriods.push({
      capability: name,
      months: term === "null" || term === "" ? null : Number(term),
    });
  }
  return { benefits, benefitPeriods };
}

export function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length === 0 ? undefined : Number(text);
}

export function optionalText(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length === 0 ? undefined : text;
}

export function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}
