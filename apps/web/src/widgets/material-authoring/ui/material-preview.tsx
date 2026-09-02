import type { ReactNode } from "react";

import { MaterialAssetFile, MaterialAssetImage } from "@/features/material-assets";
import { materialTaxonomyLabel } from "@/entities/material";

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
            {materialTaxonomyLabel(preview.format)}
          </span>
          <span>{materialTaxonomyLabel(preview.topic)}</span>
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
          <PreviewBlock block={block} contentVersion={preview.contentVersion} key={`${block.kind}-${String(index)}`} materialId={preview.materialId} />
        ))}
      </div>
    </article>
  );
}

function PreviewBlock({ block, contentVersion, materialId }: {
  readonly block: MaterialPreviewBlock;
  readonly contentVersion: number;
  readonly materialId: string;
}) {
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
                <PreviewBlock block={child} contentVersion={contentVersion} key={`${child.kind}-${String(childIndex)}`} materialId={materialId} />
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
            <PreviewBlock block={child} contentVersion={contentVersion} key={`${child.kind}-${String(index)}`} materialId={materialId} />
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
    case "table":
      return <PreviewTable block={block} contentVersion={contentVersion} materialId={materialId} />;
    case "callout":
      return (
        <aside className="rounded-xl bg-secondary px-5 py-5 text-secondary-foreground">
          <div className="font-semibold">
            {block.tone === "warning" ? "Обратите внимание" : block.tone === "tip" ? "Практика" : "Контекст"}
          </div>
          <div className="mt-2 space-y-3">
            {block.content.map((child, index) => (
              <PreviewBlock block={child} contentVersion={contentVersion} key={`${child.kind}-${String(index)}`} materialId={materialId} />
            ))}
          </div>
        </aside>
      );
    case "image":
      return (
        <MaterialAssetImage
          alt={block.alt}
          assetId={block.assetId}
          caption={block.caption}
          contentVersion={contentVersion}
          height={block.height}
          materialId={materialId}
          preview
          variants={block.variants}
          width={block.width}
        />
      );
    case "file":
      return <MaterialAssetFile assetId={block.assetId} contentType={block.contentType} contentVersion={contentVersion} filename={block.filename} label={block.label} materialId={materialId} preview size={block.size} />;
  }
}

function PreviewTable({
  block,
  contentVersion,
  materialId,
}: {
  readonly block: Extract<MaterialPreviewBlock, { readonly kind: "table" }>;
  readonly contentVersion: number;
  readonly materialId: string;
}) {
  return (
    <div
      aria-label="Таблица в предпросмотре"
      className="max-w-full overflow-x-auto rounded-xl border border-border"
      role="region"
      tabIndex={0}
    >
      <table className="min-w-[36rem] border-collapse text-left text-sm leading-6">
        <caption className="sr-only">Таблица в предпросмотре</caption>
        <tbody className="divide-y divide-border">
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, cellIndex) => {
                const Cell = cell.header ? "th" : "td";
                return (
                  <Cell
                    className={cell.header ? "bg-muted px-4 py-3 font-semibold" : "px-4 py-3"}
                    key={cellIndex}
                    scope={cell.header ? "col" : undefined}
                  >
                    <div className="space-y-3">
                      {cell.content.map((child, childIndex) => (
                        <PreviewBlock block={child} contentVersion={contentVersion} key={`${child.kind}-${String(childIndex)}`} materialId={materialId} />
                      ))}
                    </div>
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
