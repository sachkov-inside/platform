import { ArrowLeft, BookOpenText } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
  ReaderMark,
  ReaderText,
} from "@/_pages/material-reader/model/material-reader-view";
import type { RelatedMaterialsResult } from "@/features/library-discovery";
import { RelatedMaterialsSection } from "@/features/library-discovery";
import { materialTaxonomyLabel } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import { MaterialAssetFile, MaterialAssetImage } from "@/features/material-assets";
import { MaterialResourcePlaceholder } from "@/shared/ui/material-resource-placeholder";
import {
  libraryMaterialReaderReturnTarget,
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

export interface MaterialReaderViewProps {
  readonly body: readonly ReaderBlock[];
  readonly material: MaterialReaderMetadata;
  readonly related?: RelatedMaterialsResult;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly sourceHref?: Route;
}

interface OutlineItem {
  readonly id: string;
  readonly label: string;
  readonly level: 2 | 3 | 4;
}

/** Client-safe presentation shared by the production RSC route and Storybook. */
export function MaterialReaderView({
  body,
  material,
  related,
  returnTarget = libraryMaterialReaderReturnTarget,
  sourceHref,
}: MaterialReaderViewProps) {
  const outline = collectOutline(body);

  return (
    <div className="@container/material-reader" data-material-reader-state="available">
      <ReaderBackAction target={returnTarget} />
      <div className="mt-10 min-w-0">
        <MaterialHeader material={material} />
        <ReaderOutline items={outline} />
        <article
          className="mt-10 min-w-0 max-w-[70ch] text-pretty text-[0.96875rem] leading-[1.7] sm:mt-12 sm:text-[1.0625rem]"
          data-reader-body
        >
          <ReaderBlocks blocks={body} contentVersion={material.contentVersion} materialId={material.materialId} path={[]} />
        </article>
      </div>
      {related === undefined ? null : (
        <RelatedMaterialsSection
          result={related}
          sourceHref={sourceHref ?? materialReaderHref(material.slug)}
        />
      )}
      <ReaderBackAction className="mt-16" target={returnTarget} />
    </div>
  );
}

function MaterialHeader({ material }: { readonly material: MaterialReaderMetadata }) {
  const publicationDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(material.publishedAt));

  return (
    <header className="min-w-0 max-w-[56rem]">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 font-semibold text-secondary-foreground">
          <BookOpenText aria-hidden="true" className="size-3.5 text-accent" />
          {materialTaxonomyLabel(material.format.name)}
        </span>
        <Link
          className="inline-flex min-h-7 items-center rounded-md px-2 no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
          href={`/topics/${material.topic.slug}`}
          prefetch={false}
        >
          {material.topic.name}
        </Link>
        <time dateTime={material.publishedAt}>Опубликовано {publicationDate}</time>
      </div>
      <h1 className="mt-5 max-w-[22ch] text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[2.25rem] @min-[62rem]/material-reader:text-[2.5rem]">
        {material.title}
      </h1>
      <p className="mt-4 max-w-[65ch] text-pretty text-[0.9375rem] leading-6 text-muted-foreground sm:mt-5 sm:text-base sm:leading-7">
        {material.summary}
      </p>
      <MaterialContext material={material} />
    </header>
  );
}

function MaterialContext({ material }: { readonly material: MaterialReaderMetadata }) {
  if (material.tags.length === 0 && material.seriesMemberships.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 grid gap-3">
      {material.tags.length > 0 ? (
        <ul aria-label="Теги материала" className="flex flex-wrap gap-2" role="list">
          {material.tags.map((tag) => (
            <li key={tag.name}>
              <span className="inline-flex min-h-8 items-center rounded-md bg-muted px-2.5 py-1.5 font-mono text-[0.6875rem] text-muted-foreground">
                {tag.name}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {material.seriesMemberships.length > 0 ? (
        <ul aria-label="Плейлисты материала" className="flex flex-wrap gap-x-4 gap-y-2" role="list">
          {material.seriesMemberships.map(({ ordinal, series }) => (
            <li key={series.slug}>
              <Link
                className="inline-flex min-h-8 items-center rounded-md px-2 font-mono text-xs text-muted-foreground no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
                href={`/series/${series.slug}`}
                prefetch={false}
              >
                {series.name} · выпуск {ordinal}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ReaderBackAction({
  className = "",
  target,
}: {
  readonly className?: string;
  readonly target: MaterialReaderReturnTarget;
}) {
  return (
    <div className={`flex min-h-11 items-center border-b border-border pb-3 ${className}`}>
      <Button asChild className="bg-background" size="lg" variant="outline">
        <Link href={target.href}>
          <ArrowLeft aria-hidden="true" />
          {target.label}
        </Link>
      </Button>
    </div>
  );
}

function ReaderOutline({ items }: { readonly items: readonly OutlineItem[] }) {
  if (items.length === 0) {
    return null;
  }

  const links = items.map((item) => (
    <li key={item.id}>
      <a
        className="flex min-h-10 items-center rounded-lg px-2 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
        href={`#${item.id}`}
      >
        {item.label}
      </a>
    </li>
  ));

  return (
    <div className="mt-6 max-w-[70ch]">
      <details className="group rounded-xl bg-muted/60 @min-[40rem]/material-reader:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 text-sm font-semibold focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          В этом материале
          <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
            {items.length}
          </span>
        </summary>
        <nav aria-label="В этом материале" className="border-t border-border px-1.5 py-1.5">
          <ul role="list">{links}</ul>
        </nav>
      </details>
      <nav
        aria-label="В этом материале"
        className="hidden rounded-xl bg-muted/60 px-2 py-3 @min-[40rem]/material-reader:block"
      >
        <p className="px-2 text-sm font-semibold">В этом материале</p>
        <ul className="mt-2 flex flex-wrap gap-2" role="list">
          {links}
        </ul>
      </nav>
    </div>
  );
}

function ReaderBlocks({
  blocks,
  contentVersion,
  materialId,
  path,
}: {
  readonly blocks: readonly ReaderBlock[];
  readonly contentVersion: number;
  readonly materialId: string;
  readonly path: readonly number[];
}) {
  return blocks.map((block, index) => {
    const blockPath = [...path, index];
    return <ReaderBlockView block={block} contentVersion={contentVersion} key={blockPath.join("-")} materialId={materialId} path={blockPath} />;
  });
}

function ReaderBlockView({
  block,
  contentVersion,
  materialId,
  path,
}: {
  readonly block: ReaderBlock;
  readonly contentVersion: number;
  readonly materialId: string;
  readonly path: readonly number[];
}) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="mt-5 first:mt-0">
          <ReaderInline content={block.content} />
        </p>
      );
    case "heading": {
      const Heading = `h${String(block.level)}` as "h2" | "h3" | "h4";
      return (
        <Heading
          className="mt-12 scroll-mt-8 text-balance text-xl font-semibold leading-tight tracking-[-0.03em] first:mt-0 sm:mt-14 sm:text-2xl"
          id={headingId(path)}
        >
          <ReaderInline content={block.content} />
        </Heading>
      );
    }
    case "bullet_list":
    case "ordered_list": {
      const List = block.kind === "bullet_list" ? "ul" : "ol";
      return (
        <List className="mt-5 space-y-2 pl-6 marker:text-accent">
          {block.items.map((item, index) => (
            <li key={index}>
              <ReaderBlocks blocks={item} contentVersion={contentVersion} materialId={materialId} path={[...path, index]} />
            </li>
          ))}
        </List>
      );
    }
    case "blockquote":
      return (
        <blockquote className="mt-6 border-l-4 border-accent pl-5 text-muted-foreground">
          <ReaderBlocks blocks={block.content} contentVersion={contentVersion} materialId={materialId} path={path} />
        </blockquote>
      );
    case "code_block":
      return (
        <pre
          className="mt-6 overflow-x-auto rounded-xl bg-sidebar p-5 font-mono text-[0.8125rem] leading-6 text-sidebar-foreground [scrollbar-color:var(--sidebar-border)_var(--sidebar)]"
          tabIndex={0}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "horizontal_rule":
      return <hr className="my-10 border-border" />;
    case "table":
      return <ReaderTable block={block} contentVersion={contentVersion} materialId={materialId} path={path} />;
    case "callout":
      return (
        <aside
          aria-label={calloutLabel(block.tone)}
          className="mt-6 rounded-xl bg-secondary px-5 py-5 text-[0.9375rem] leading-7 text-secondary-foreground sm:px-6"
        >
          <p className="font-semibold">{calloutLabel(block.tone)}</p>
          <ReaderBlocks blocks={block.content} contentVersion={contentVersion} materialId={materialId} path={path} />
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
          variants={block.variants}
          width={block.width}
        />
      );
    case "file":
      return (
        <MaterialAssetFile
          assetId={block.assetId}
          contentType={block.contentType}
          contentVersion={contentVersion}
          filename={block.filename}
          label={block.label}
          materialId={materialId}
          size={block.size}
        />
      );
    case "video":
      return (
        <MaterialResourcePlaceholder
          caption={block.caption}
          className="mt-7"
          id={resourceId(path)}
          kind="video"
        />
      );
  }
}

function ReaderInline({ content }: { readonly content: readonly ReaderText[] }) {
  return content.map((text, index) => (
    <span key={index}>{applyMarks(text.text, text.marks, index)}</span>
  ));
}

function applyMarks(text: string, marks: readonly ReaderMark[], key: number): ReactNode {
  return marks.reduceRight<ReactNode>((child, mark, index) => {
    const markKey = `${String(key)}-${String(index)}`;
    switch (mark.kind) {
      case "bold":
        return <strong key={markKey}>{child}</strong>;
      case "code":
        return (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]" key={markKey}>
            {child}
          </code>
        );
      case "italic":
        return <em key={markKey}>{child}</em>;
      case "strike":
        return <s key={markKey}>{child}</s>;
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

function ReaderTable({
  block,
  contentVersion,
  materialId,
  path,
}: {
  readonly block: Extract<ReaderBlock, { readonly kind: "table" }>;
  readonly contentVersion: number;
  readonly materialId: string;
  readonly path: readonly number[];
}) {
  return (
    <div
      aria-label="Таблица в материале"
      className="mt-7 max-w-full overflow-x-auto rounded-xl border border-border [scrollbar-color:var(--muted-foreground)_var(--muted)]"
      role="region"
      tabIndex={0}
    >
      <table className="min-w-[36rem] border-collapse text-left text-sm leading-6">
        <caption className="sr-only">Таблица в материале</caption>
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
                    <ReaderBlocks
                      blocks={cell.content}
                      contentVersion={contentVersion}
                      materialId={materialId}
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

function collectOutline(blocks: readonly ReaderBlock[], path: readonly number[] = []): OutlineItem[] {
  return blocks.flatMap((block, index): OutlineItem[] => {
    const blockPath = [...path, index];
    if (block.kind === "heading") {
      return [{ id: headingId(blockPath), label: textContent(block.content), level: block.level }];
    }
    if (block.kind === "blockquote" || block.kind === "callout") {
      return collectOutline(block.content, blockPath);
    }
    if (block.kind === "bullet_list" || block.kind === "ordered_list") {
      return block.items.flatMap((item, itemIndex) =>
        collectOutline(item, [...blockPath, itemIndex]),
      );
    }
    return [];
  });
}

function headingId(path: readonly number[]): string {
  return `material-section-${path.join("-")}`;
}

function resourceId(path: readonly number[]): string {
  return `material-resource-${path.join("-")}`;
}

function textContent(content: readonly ReaderText[]): string {
  return content.map(({ text }) => text).join("");
}

function calloutLabel(tone: "note" | "tip" | "warning"): string {
  return tone === "tip" ? "Совет" : tone === "warning" ? "Важно" : "Примечание";
}
