import { Fragment, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { proseLinkClassName } from "@/shared/ui/prose-link";
import { ProseAnchor } from "@/shared/ui/prose-anchor.client";

import type { RenderedMark, RenderedText } from "../../material.model";

/** A surface may replace a document link; undefined keeps the ordinary prose anchor. */
type MaterialInlineLink = (
  href: string,
  children: ReactNode,
) => ReactNode | undefined;

type InlineRun =
  | { readonly kind: "text"; readonly text: RenderedText }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly content: readonly RenderedText[];
    };

/**
 * A document stores a link as a mark on each text run, so a link whose text mixes plain words
 * and inline code arrives as several runs. Neighbouring runs with the same address become one
 * anchor: one focus stop and one accessible name, with the other marks inside it.
 */
function inlineRuns(content: readonly RenderedText[]): readonly InlineRun[] {
  const runs: InlineRun[] = [];
  for (const text of content) {
    const link = text.marks.find((mark) => mark.kind === "link");
    if (link === undefined) {
      runs.push({ kind: "text", text });
      continue;
    }
    const inner = {
      ...text,
      marks: text.marks.filter((mark) => mark.kind !== "link"),
    };
    const previous = runs.at(-1);
    if (previous?.kind === "link" && previous.href === link.href)
      runs[runs.length - 1] = {
        ...previous,
        content: [...previous.content, inner],
      };
    else runs.push({ kind: "link", href: link.href, content: [inner] });
  }
  return runs;
}

/** Inline content of one block, shared by Reader and the authoring Preview. */
export function MaterialInline({
  content,
  link,
}: {
  readonly content: readonly RenderedText[];
  readonly link?: MaterialInlineLink | undefined;
}) {
  return inlineRuns(content).map((run, index) => {
    if (run.kind === "text")
      return (
        <Fragment key={index}>
          {applyMarks(run.text.text, run.text.marks, false)}
        </Fragment>
      );
    const children = run.content.map((text, part) => (
      <Fragment key={part}>{applyMarks(text.text, text.marks, true)}</Fragment>
    ));
    const custom = link?.(run.href, children);
    return custom === undefined ? (
      <ProseAnchor className={proseLinkClassName} href={run.href} key={index}>
        {children}
      </ProseAnchor>
    ) : (
      <Fragment key={index}>{custom}</Fragment>
    );
  });
}

/**
 * The first mark wraps the others, as in the stored document. Inside a link, code drops its side
 * padding: the chip background would otherwise cover the link underline next to the code.
 */
function applyMarks(
  text: string,
  marks: readonly RenderedMark[],
  linked: boolean,
): ReactNode {
  return marks.reduceRight<ReactNode>((child, mark) => {
    switch (mark.kind) {
      case "bold":
        return <strong>{child}</strong>;
      case "code":
        return (
          <code
            className={cn(
              "rounded bg-muted py-0.5 font-mono text-[0.9em]",
              !linked && "px-1.5",
            )}
          >
            {child}
          </code>
        );
      case "italic":
        return <em>{child}</em>;
      case "strike":
        return <s>{child}</s>;
      case "link":
        // Links are grouped by `inlineRuns` before marks are applied.
        return child;
    }
  }, text);
}
