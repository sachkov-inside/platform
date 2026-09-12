import type { CalloutTone } from "@inside/material-blocks";
import type { ReactNode } from "react";

import { calloutTonePresentation } from "./callout-tone";

/**
 * Врезка урока. Вид виден словом, значком и цветом; цвет берётся из токена вида, а не из
 * собственной палитры блока.
 */
export function MaterialCallout({
  children,
  title,
  tone,
}: {
  readonly children?: ReactNode;
  readonly title?: string | undefined;
  readonly tone: CalloutTone;
}) {
  const presentation = calloutTonePresentation(tone);
  const label = presentation.label;

  return (
    <aside
      aria-label={title === undefined ? label : `${label}: ${title}`}
      className="mt-8 rounded-xl border px-5 py-4 text-[0.9375rem] leading-7 sm:px-6"
      data-callout={tone}
      data-material-block="callout"
    >
      <p
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: "var(--callout-ink)" }}
      >
        <presentation.icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </p>
      {title === undefined ? null : (
        <p className="mt-1 font-semibold text-foreground">{title}</p>
      )}
      {children}
    </aside>
  );
}
