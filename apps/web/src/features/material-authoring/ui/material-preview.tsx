import type { ReactNode } from "react";

import type {
  MaterialPreviewBlock,
  MaterialPreviewMark,
  MaterialPreviewPresentation,
  MaterialPreviewText,
} from "../model/presentation";

interface MaterialPreviewProps {
  readonly preview: MaterialPreviewPresentation;
}

/** Current-Material reading surface shared by Storybook and future production adapters. */
export function MaterialPreview({ preview }: MaterialPreviewProps) {
  return (
    <article className="mx-auto w-full max-w-[72ch] px-5 py-10 sm:px-8 sm:py-14">
      <header>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
          <span className="rounded-full bg-secondary px-2.5 py-1.5 font-semibold text-secondary-foreground">
            {preview.format}
          </span>
          <span>{preview.topic}</span>
          <span aria-hidden="true">·</span>
          <span>{preview.accessLabel}</span>
        </div>
        <h1 className="mt-5 text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[2.75rem]">
          {preview.title}
        </h1>
        <p className="mt-4 max-w-[65ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          {preview.summary}
        </p>
        <ul aria-label="Теги материала" className="mt-5 flex flex-wrap gap-2" role="list">
          {preview.tags.map((tag) => (
            <li className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-[0.6875rem] text-muted-foreground" key={tag}>
              {tag}
            </li>
          ))}
        </ul>
      </header>
      <div className="mt-12 space-y-6 text-pretty text-[1rem] leading-[1.75] sm:text-[1.0625rem]">
        {preview.blocks.map((block, index) => (
          <PreviewBlock block={block} key={`${block.kind}-${String(index)}`} />
        ))}
      </div>
    </article>
  );
}

function PreviewBlock({ block }: { readonly block: MaterialPreviewBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p>{renderInline(block.content)}</p>;
    case "heading": {
      const content = renderInline(block.content);
      if (block.level === 2) {
        return <h2 className="pt-6 text-2xl font-semibold tracking-[-0.025em]">{content}</h2>;
      }
      if (block.level === 3) {
        return <h3 className="pt-4 text-xl font-semibold tracking-[-0.02em]">{content}</h3>;
      }
      return <h4 className="pt-3 text-lg font-semibold">{content}</h4>;
    }
    case "bullet_list":
    case "ordered_list": {
      const List = block.kind === "bullet_list" ? "ul" : "ol";
      return (
        <List className="ml-6 space-y-2 marker:text-accent">
          {block.items.map((item, index) => (
            <li key={index}>
              {item.map((child, childIndex) => (
                <PreviewBlock block={child} key={`${child.kind}-${String(childIndex)}`} />
              ))}
            </li>
          ))}
        </List>
      );
    }
    case "blockquote":
      return (
        <blockquote className="border-l border-border pl-5 text-muted-foreground">
          {block.content.map((child, index) => (
            <PreviewBlock block={child} key={`${child.kind}-${String(index)}`} />
          ))}
        </blockquote>
      );
    case "code_block":
      return (
        <pre className="max-w-full overflow-x-auto rounded-xl bg-sidebar p-5 font-mono text-[0.8125rem] leading-6 text-sidebar-foreground" tabIndex={0}>
          <code>{block.text}</code>
        </pre>
      );
    case "horizontal_rule":
      return <hr className="my-10 border-border" />;
    case "callout":
      return (
        <aside className="rounded-xl bg-secondary px-5 py-5 text-secondary-foreground">
          <div className="font-semibold">
            {block.tone === "warning" ? "Обратите внимание" : block.tone === "tip" ? "Практика" : "Контекст"}
          </div>
          <div className="mt-2 space-y-3">
            {block.content.map((child, index) => (
              <PreviewBlock block={child} key={`${child.kind}-${String(index)}`} />
            ))}
          </div>
        </aside>
      );
  }
}

function renderInline(content: readonly MaterialPreviewText[]): readonly ReactNode[] {
  return content.map((part, index) => applyMarks(part.text, part.marks, index));
}

function applyMarks(
  text: string,
  marks: readonly MaterialPreviewMark[],
  key: number,
): ReactNode {
  return marks.reduce<ReactNode>((node, mark, index) => {
    const markKey = `${String(key)}-${String(index)}`;
    switch (mark.kind) {
      case "bold":
        return <strong key={markKey}>{node}</strong>;
      case "code":
        return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]" key={markKey}>{node}</code>;
      case "italic":
        return <em key={markKey}>{node}</em>;
      case "strike":
        return <s key={markKey}>{node}</s>;
      case "link":
        return <a className="underline decoration-accent underline-offset-4" href={mark.href} key={markKey}>{node}</a>;
    }
  }, text);
}
