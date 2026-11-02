import type { CalloutTone } from "@inside/material-blocks";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { calloutTonePresentation } from "./callout-tone";

/**
 * Блок кода во врезке занимает её тело до краёв: тёмная поверхность продолжает врезку, а не
 * рисует вторую рамку внутри первой. Нижний блок кода закрывает врезку по её скруглению.
 */
const codeBlockFill =
  "[&>[data-material-block=codeBlock]]:mx-[calc(-1*var(--callout-pad-x))] [&>[data-material-block=codeBlock]]:mt-4 [&>[data-material-block=codeBlock]]:rounded-none [&>[data-material-block=codeBlock]:last-child]:mb-[calc(-1*var(--callout-pad-b))] [&>[data-material-block=codeBlock]:last-child]:rounded-b-[calc(var(--radius-xl)-1px)]";

/**
 * Врезка урока. Вид виден словом, значком и цветом; цвет берётся из токена вида, а не из
 * собственной палитры блока.
 * Temporary semantic UI for #1196.
 * Replace through #1278 after Storybook acceptance.
 */
export function MaterialCallout({
  children,
  collapse,
  title,
  tone,
}: {
  readonly children?: ReactNode;
  readonly collapse?: "collapsed" | "expanded" | undefined;
  readonly title?: string | undefined;
  readonly tone: CalloutTone;
}) {
  const presentation = calloutTonePresentation(tone);
  const label = presentation.label;

  if (collapse !== undefined) {
    return (
      <details
        className="group mt-6 rounded-xl border text-[0.9375rem] leading-7"
        data-callout={tone}
        data-material-block="callout"
        open={collapse === "expanded"}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 group-open:rotate-90"
          />
          <presentation.icon
            aria-hidden="true"
            className="size-4 shrink-0"
            style={{ color: "var(--callout-ink)" }}
          />
          {title ?? label}
        </summary>
        <div
          className={`px-(--callout-pad-x) pb-(--callout-pad-b) [--callout-pad-b:--spacing(3)] [--callout-pad-x:--spacing(4)] ${codeBlockFill} [&>:first-child]:mt-0 [&>[data-material-block=codeBlock]:first-child]:mt-0`}
        >
          {children}
        </div>
      </details>
    );
  }

  return (
    <aside
      aria-label={title === undefined ? label : `${label}: ${title}`}
      className={`mt-8 rounded-xl border px-(--callout-pad-x) pt-4 pb-(--callout-pad-b) text-[0.9375rem] leading-7 [--callout-pad-b:--spacing(4)] [--callout-pad-x:--spacing(5)] sm:[--callout-pad-x:--spacing(6)] ${codeBlockFill}`}
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
