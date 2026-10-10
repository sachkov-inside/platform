import { Fragment, type ReactNode } from "react";

import { BodyFragmentNavigation } from "@/shared/ui/body-fragment-navigation.client";
import { materialSourceAnchors } from "../model/material-source-anchors";
import { cn } from "@/shared/lib/utils";
import type {
  RenderedBlock,
  RenderedMark,
  RenderedText,
} from "../../material.model";
import { MaterialLessonBlock } from "./material-blocks";

/** Content owns the document; each surface owns asset authorization and addresses. */
export interface MaterialBodyRendering {
  readonly image: (
    block: Extract<RenderedBlock, { kind: "image" }>,
  ) => ReactNode;
  readonly file: (block: Extract<RenderedBlock, { kind: "file" }>) => ReactNode;
  /** Existing surface address retained as an alias unless a Content heading owns it. */
  readonly headingId: (path: readonly number[]) => string;
}

interface BodyRendering extends MaterialBodyRendering {
  readonly sourceIds: ReadonlySet<string>;
  readonly legacyHeadingId: (path: readonly number[]) => string;
}

/** Allocate source anchors once for the whole document, including nested branches. */
export function MaterialBodyView(props: {
  readonly blocks: readonly RenderedBlock[];
  readonly rendering: MaterialBodyRendering;
  readonly hint?: ReactNode;
  readonly hintAt?: number | undefined;
  readonly path: readonly number[];
}) {
  const anchors = materialSourceAnchors(props.blocks, props.path);
  return (
    <>
      <BodyBlocks
        {...props}
        rendering={{
          ...props.rendering,
          headingId: (path) =>
            anchors.get(path.join("-")) ?? props.rendering.headingId(path),
          legacyHeadingId: props.rendering.headingId,
          sourceIds: new Set(anchors.values()),
        }}
      />
      <BodyFragmentNavigation />
    </>
  );
}

function BodyBlocks({
  blocks,
  rendering,
  hint,
  hintAt,
  path,
}: {
  readonly blocks: readonly RenderedBlock[];
  readonly rendering: BodyRendering;
  readonly hint?: ReactNode;
  readonly hintAt?: number | undefined;
  readonly path: readonly number[];
}) {
  return blocks.map((block, index) => {
    const blockPath = [...path, index];
    const view = (
      <BodyBlockView
        block={block}
        rendering={rendering}
        key={blockPath.join("-")}
        path={blockPath}
      />
    );
    if (index !== hintAt) return view;
    return (
      <Fragment key={`hint-${blockPath.join("-")}`}>
        {hint}
        {view}
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
          <BodyInline content={block.content} />
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
          <BodyInline content={block.content} />
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
        <pre
          className="mt-8 overflow-x-auto rounded-xl bg-sidebar p-5 font-mono text-[0.8125rem] leading-6 text-sidebar-foreground [scrollbar-color:var(--sidebar-border)_var(--sidebar)]"
          tabIndex={0}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "horizontal_rule":
      return <hr className="my-12 border-border" />;
    case "table":
      return <BodyTable block={block} rendering={rendering} path={path} />;
    case "quiz":
    case "agent_prompt":
    case "callout":
    case "key_point":
    case "labeled_list":
    case "resource_card":
    case "takeaways":
    case "variant":
      return (
        <MaterialLessonBlock
          block={block}
          rendering={{
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
            renderInline: (content) => <BodyInline content={content} />,
          }}
        />
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
}: {
  readonly content: readonly RenderedText[];
}) {
  return content.map((text, index) => (
    <span key={index}>{applyMarks(text.text, text.marks, index)}</span>
  ));
}

function applyMarks(
  text: string,
  marks: readonly RenderedMark[],
  key: number,
): ReactNode {
  return marks.reduceRight<ReactNode>((child, mark, index) => {
    const markKey = `${String(key)}-${String(index)}`;
    switch (mark.kind) {
      case "bold":
        return <strong key={markKey}>{child}</strong>;
      case "code":
        return (
          <code
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]"
            key={markKey}
          >
            {child}
          </code>
        );
      case "italic":
        return <em key={markKey}>{child}</em>;
      case "strike":
        return <s key={markKey}>{child}</s>;
      case "term":
        return (
          <span data-term-id={mark.termId} key={markKey}>
            {child}
          </span>
        );
      case "link":
        return (
          <a
            className="underline decoration-border underline-offset-4 hover:decoration-accent"
            href={mark.href}
            key={markKey}
          >
            {child}
          </a>
        );
    }
  }, text);
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
