import { Fragment, type ReactNode } from "react";

import { BodyFragmentNavigation } from "@/shared/ui/body-fragment-navigation.client";
import { materialSourceAnchors } from "../model/material-source-anchors";
import { cn } from "@/shared/lib/utils";
import type { RenderedBlock, RenderedText } from "../../material.model";
import { MaterialLessonBlock } from "./material-blocks";
import {
  glossaryTermIdOf,
  isGlossaryTermHref,
  materialExerciseNumbers,
  type MaterialExerciseNumber,
} from "@inside/material-blocks";
import type { GlossaryTerms } from "../model/glossary-term";
import { GlossaryDefinitionCard } from "./glossary/glossary-definition-card";
import { GlossaryTermMention } from "./glossary/glossary-term-mention.client";
import { MaterialCodeBlock } from "./material-code-block.client";
import {
  codeHighlightKey,
  type MaterialCodeHighlights,
} from "../model/code-highlight";
import { MaterialInline } from "./material-inline";
import { MaterialModelComparison } from "./material-model-comparison.client";
import { lessonParts } from "../model/lesson-parts";
import {
  LessonCut,
  LessonExerciseAnswers,
  LessonGateControl,
} from "./lesson-step-controls.client";

export interface MaterialBodyComparison {
  readonly at: number;
  readonly labels: readonly string[];
}

/** Content owns the document; each surface owns asset authorization and addresses. */
export interface MaterialBodyRendering {
  readonly video?: (
    block: Extract<RenderedBlock, { kind: "video" }>,
  ) => ReactNode;
  readonly image: (
    block: Extract<RenderedBlock, { kind: "image" }>,
  ) => ReactNode;
  readonly file: (block: Extract<RenderedBlock, { kind: "file" }>) => ReactNode;
  /** A surface may enrich a known link; undefined keeps the document link unchanged. */
  readonly link?: (
    href: string,
    children: ReactNode,
    path: readonly number[],
  ) => ReactNode | undefined;
  /** Existing surface address retained as an alias unless a Content heading owns it. */
  readonly headingId: (path: readonly number[]) => string;
  /**
   * Glossary Terms the body mentions, read with the body. A `term:` link or card whose term is
   * absent shows plain text or nothing: a surface without terms, such as the authoring preview,
   * never sends the reader to a `term:` address.
   */
  readonly glossary?: GlossaryTerms | undefined;
  /**
   * «Упражнение N из M» by exercise id. Omitted, the body numbers its own exercises; a surface
   * that shows one exercise apart from its lesson passes an empty map.
   */
  readonly exerciseNumbers?:
    ReadonlyMap<string, MaterialExerciseNumber> | undefined;
  /** Server-side highlighting of the body's code; omitted, code shows in one colour. */
  readonly codeHighlights?: MaterialCodeHighlights | undefined;
}

interface BodyRendering extends MaterialBodyRendering {
  readonly sourceIds: ReadonlySet<string>;
  readonly legacyHeadingId: (path: readonly number[]) => string;
}

/** Allocate source anchors once for the whole document, including nested branches. */
export function MaterialBodyView(props: {
  readonly blocks: readonly RenderedBlock[];
  readonly rendering: MaterialBodyRendering;
  /** Display top-level blocks in this order, retaining every original path and anchor. */
  readonly blockOrder?: readonly number[] | undefined;
  readonly comparison?: MaterialBodyComparison | undefined;
  readonly illustrations?:
    readonly { readonly after: number; readonly node: ReactNode }[] | undefined;
  readonly path: readonly number[];
}) {
  const anchors = materialSourceAnchors(props.blocks, props.path);
  // Each gate ends a part: its control and the cut of the next part follow the gate block (#2122).
  const steps = lessonParts(props.blocks).gates.map((gate, ordinal) => ({
    after: gate.at,
    node: (
      <Fragment key={`lesson-step-${String(ordinal)}`}>
        <LessonGateControl gate={gate} ordinal={ordinal} />
        <LessonCut part={ordinal + 1} />
      </Fragment>
    ),
  }));
  const illustrations =
    steps.length === 0
      ? props.illustrations
      : [
          ...(props.illustrations ?? []).filter(
            (item) => !steps.some((step) => step.after === item.after),
          ),
          ...steps.map((step) => {
            const illustration = props.illustrations?.find(
              (item) => item.after === step.after,
            );
            return illustration === undefined
              ? step
              : {
                  after: step.after,
                  node: (
                    <>
                      {illustration.node}
                      {step.node}
                    </>
                  ),
                };
          }),
        ];
  return (
    <LessonExerciseAnswers>
      <BodyBlocks
        {...props}
        illustrations={illustrations}
        rendering={{
          ...props.rendering,
          headingId: (path) =>
            anchors.get(path.join("-")) ?? props.rendering.headingId(path),
          legacyHeadingId: props.rendering.headingId,
          sourceIds: new Set(anchors.values()),
          exerciseNumbers:
            props.rendering.exerciseNumbers ??
            materialExerciseNumbers(props.blocks),
        }}
      />
      <BodyFragmentNavigation />
    </LessonExerciseAnswers>
  );
}

function BodyBlocks({
  blocks,
  rendering,
  blockOrder,
  comparison,
  illustrations,
  path,
}: {
  readonly blocks: readonly RenderedBlock[];
  readonly rendering: BodyRendering;
  /** Display top-level blocks in this order, retaining every original path and anchor. */
  readonly blockOrder?: readonly number[] | undefined;
  readonly comparison?: MaterialBodyComparison | undefined;
  readonly illustrations?:
    readonly { readonly after: number; readonly node: ReactNode }[] | undefined;
  readonly path: readonly number[];
}) {
  const positions = new Map(
    blockOrder?.map((index, position) => [index, position]),
  );
  const indices = blocks.map((_, index) => index);
  if (blockOrder !== undefined)
    indices.sort(
      (left, right) =>
        (positions.get(left) ?? blockOrder.length + left) -
        (positions.get(right) ?? blockOrder.length + right),
    );
  return indices.map((index) => {
    const block = blocks[index];
    if (block === undefined) return null;
    const blockPath = [...path, index];
    if (
      comparison !== undefined &&
      index > comparison.at &&
      index < comparison.at + comparison.labels.length
    )
      return null;
    const view =
      index === comparison?.at ? (
        <MaterialModelComparison
          key={comparison.labels.join("-")}
          items={comparison.labels.flatMap((label, offset) => {
            const card = blocks[index + offset];
            if (card?.kind !== "callout" || card.title === undefined) return [];
            return [
              {
                label,
                title: card.title,
                content: (
                  <BodyBlocks
                    blocks={card.content}
                    rendering={rendering}
                    path={[...path, index + offset]}
                  />
                ),
              },
            ];
          })}
        />
      ) : (
        <BodyBlockView
          block={block}
          rendering={rendering}
          key={blockPath.join("-")}
          path={blockPath}
        />
      );
    const illustration = illustrations?.find(
      (item) => item.after === index,
    )?.node;
    if (illustration === undefined) return view;
    return (
      <Fragment key={`illustration-${blockPath.join("-")}`}>
        {view}
        {illustration}
      </Fragment>
    );
  });
}

const headingTag = { 2: "h2", 3: "h3", 4: "h4" } as const;

function BodyBlockView({
  block,
  rendering,
  path,
}: {
  readonly block: RenderedBlock;
  readonly rendering: BodyRendering;
  readonly path: readonly number[];
}) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="mt-6 min-h-7 first:mt-0">
          <BodyInline
            content={block.content}
            link={rendering.link}
            glossary={rendering.glossary}
            path={path}
          />
        </p>
      );
    case "heading": {
      const Heading = headingTag[block.level];
      return (
        <Heading
          className={cn(
            "scroll-mt-24 break-words text-balance font-semibold text-foreground first:mt-0",
            block.level === 2 &&
              "mt-12 text-xl leading-[1.35] tracking-[-0.025em] md:text-2xl md:leading-[1.3]",
            block.level === 3 &&
              "mt-10 text-lg md:text-xl leading-[1.35] tracking-[-0.02em]",
            block.level === 4 &&
              "mt-8 text-base md:text-lg leading-[1.45] tracking-[-0.015em]",
          )}
          id={rendering.headingId(path)}
        >
          {rendering.sourceIds.has(rendering.legacyHeadingId(path)) ? null : (
            <span
              aria-hidden="true"
              className="block scroll-mt-24"
              id={rendering.legacyHeadingId(path)}
            />
          )}
          <BodyInline
            content={block.content}
            link={rendering.link}
            glossary={rendering.glossary}
            path={path}
          />
        </Heading>
      );
    }
    case "bullet_list":
    case "ordered_list": {
      const List = block.kind === "bullet_list" ? "ul" : "ol";
      return (
        <List
          start={block.kind === "ordered_list" ? block.start : undefined}
          className={
            block.kind === "bullet_list"
              ? "mt-6 list-disc space-y-3 pl-7 marker:text-accent"
              : "mt-6 list-decimal space-y-3 pl-7 marker:font-semibold marker:text-accent"
          }
        >
          {block.items.map((item, index) => (
            <li key={index}>
              <BodyBlocks
                blocks={item}
                rendering={rendering}
                path={[...path, index]}
              />
            </li>
          ))}
        </List>
      );
    }
    case "blockquote":
      return (
        <blockquote className="mt-8 border-l-4 border-accent py-1 pl-5 text-muted-foreground">
          <BodyBlocks
            blocks={block.content}
            rendering={rendering}
            path={path}
          />
        </blockquote>
      );
    case "code_block":
      return (
        <MaterialCodeBlock
          highlighted={rendering.codeHighlights?.get(codeHighlightKey(block))}
          language={block.language}
          text={block.text}
        />
      );
    case "horizontal_rule":
      return <hr className="my-12 border-border" />;
    case "table":
      return <BodyTable block={block} rendering={rendering} path={path} />;
    // The body places a step break's button after the block, where its part ends (#2122).
    case "step_break":
      return null;
    case "quiz":
    case "match":
    case "order":
    case "agent_prompt":
    case "callout":
    case "key_point":
    case "labeled_list":
    case "resource_card":
    case "takeaways":
      return (
        <MaterialLessonBlock
          block={block}
          rendering={{
            exerciseNumber: (id) => rendering.exerciseNumbers?.get(id),
            renderBlock: (child, index) => (
              <BodyBlockView
                block={child}
                rendering={rendering}
                key={[...path, index].join("-")}
                path={[...path, index]}
              />
            ),
            renderBlocks: (blocks, branch) => (
              <BodyBlocks
                blocks={blocks}
                rendering={rendering}
                path={branch === undefined ? path : [...path, branch]}
              />
            ),
            renderInline: (content) => (
              <BodyInline
                content={content}
                link={rendering.link}
                glossary={rendering.glossary}
                path={path}
              />
            ),
          }}
        />
      );
    case "term_definition": {
      const term = rendering.glossary?.get(block.termId);
      return term === undefined ? null : <GlossaryDefinitionCard term={term} />;
    }
    case "video":
      return (
        <div className="mt-8 first:mt-0" data-reader-block="video">
          {rendering.video?.(block)}
        </div>
      );
    case "image":
      return (
        <div className="mt-8" data-reader-block="image">
          {rendering.image(block)}
        </div>
      );
    case "file":
      return (
        <div className="mt-8" data-reader-block="file">
          {rendering.file(block)}
        </div>
      );
  }
}

function BodyInline({
  content,
  glossary,
  link,
  path,
}: {
  readonly content: readonly RenderedText[];
  readonly path: readonly number[];
  readonly link?: MaterialBodyRendering["link"];
  readonly glossary?: GlossaryTerms | undefined;
}) {
  return (
    <MaterialInline
      content={content}
      link={(href, children) => {
        if (isGlossaryTermHref(href)) {
          const termId = glossaryTermIdOf(href);
          const term = termId === undefined ? undefined : glossary?.get(termId);
          return term === undefined ? (
            <>{children}</>
          ) : (
            <GlossaryTermMention term={term}>{children}</GlossaryTermMention>
          );
        }
        return link?.(href, children, path);
      }}
    />
  );
}

function BodyTable({
  block,
  rendering,
  path,
}: {
  readonly block: Extract<RenderedBlock, { readonly kind: "table" }>;
  readonly rendering: BodyRendering;
  readonly path: readonly number[];
}) {
  return (
    <div
      aria-label="Таблица в материале"
      className="mt-8 max-w-full overflow-x-auto rounded-xl border border-border [scrollbar-color:var(--muted-foreground)_var(--muted)]"
      data-reader-block="table"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[36rem] table-fixed border-collapse [overflow-wrap:anywhere] text-left text-sm leading-6">
        <caption className="sr-only">Таблица в материале</caption>
        <tbody className="divide-y divide-border">
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, cellIndex) => {
                const Cell = cell.header ? "th" : "td";
                return (
                  <Cell
                    className={
                      cell.header
                        ? "border-r border-border bg-muted px-4 py-3 font-semibold last:border-r-0"
                        : "border-r border-border px-4 py-3 last:border-r-0"
                    }
                    key={cellIndex}
                    scope={cell.header ? "col" : undefined}
                  >
                    <BodyBlocks
                      blocks={cell.content}
                      rendering={rendering}
                      path={[...path, rowIndex, cellIndex]}
                    />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
