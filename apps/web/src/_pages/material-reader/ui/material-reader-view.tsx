import { ArrowLeft, List } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
  ReaderMark,
  ReaderText,
  PrimaryVideoPresentation,
} from "@/_pages/material-reader/model/material-reader-view";
import { ContentCoverImage, materialTaxonomyLabel } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { MaterialAssetFile, MaterialAssetImage } from "@/features/material-assets";
import { MaterialPrimaryVideo } from "@/features/material-video";
import {
  libraryMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

export interface MaterialReaderViewProps {
  readonly body: readonly ReaderBlock[];
  readonly material: MaterialReaderMetadata;
  readonly primaryVideo: PrimaryVideoPresentation | null;
  readonly returnTarget?: MaterialReaderReturnTarget;
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
  primaryVideo,
  returnTarget = libraryMaterialReaderReturnTarget,
}: MaterialReaderViewProps) {
  const outline = collectOutline(body);

  return (
    <div className="@container/material-reader" data-material-id={material.materialId} data-material-reader-state="available">
      <ReaderBackAction sticky target={returnTarget} />
      <div className="mt-5 min-w-0 md:mt-10">
        <div className="mx-auto max-w-[64rem]" data-reader-hero-media>
          {primaryVideo === null ? (
            <ContentCoverImage
              alt=""
              className="aspect-video min-h-0 w-full rounded-[1.5rem] md:rounded-[2rem]"
              cover={material.cover}
              fallbackKind="material"
              fallbackSeed={material.slug}
              sizes="(min-width: 1024px) 64rem, 100vw"
            />
          ) : (
            <MaterialPrimaryVideo
              className="m-0 max-w-none sm:m-0"
              materialId={material.materialId}
              video={primaryVideo}
            />
          )}
        </div>
        <div className="mx-auto mt-8 min-w-0 max-w-[43rem] md:mt-12">
          <MaterialHeader material={material} />
          <ReaderOutline items={outline} />
          <article
            className="mt-10 min-w-0 text-pretty text-[1.0625rem] leading-8 text-reader-foreground md:mt-12"
            data-reader-body
          >
            <ReaderBlocks blocks={body} contentVersion={material.contentVersion} materialId={material.materialId} path={[]} />
          </article>
        </div>
      </div>
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
    <header className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-action">
        <span>{materialTaxonomyLabel(material.format.name)}</span>
        <span aria-hidden="true">·</span>
        <Link
          className="no-underline hover:text-foreground focus-visible:outline-ring"
          href={`/topics/${material.topic.slug}`}
          prefetch={false}
        >
          {material.topic.name}
        </Link>
      </div>
      <h1 className="mt-3 max-w-[22ch] text-balance text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.055em] md:text-[3.5rem]">
        {material.title}
      </h1>
      <p className="mt-5 max-w-[65ch] text-pretty text-lg leading-8 text-muted-foreground">
        {material.summary}
      </p>
      <MaterialContext material={material} />
      <time className="mt-5 text-xs font-semibold text-muted-foreground" dateTime={material.publishedAt}>
        Опубликовано {publicationDate}
      </time>
    </header>
  );
}

function MaterialContext({ material }: { readonly material: MaterialReaderMetadata }) {
  if (material.tags.length === 0 && material.seriesMemberships.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 grid gap-3">
      {material.tags.length > 0 ? (
        <ul aria-label="Теги материала" className="flex flex-wrap gap-2" role="list">
          {material.tags.map((tag) => (
            <li key={tag.name}>
              <span className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                #{tag.name}
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
                className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-sm font-semibold text-muted-foreground no-underline hover:text-foreground focus-visible:outline-ring"
                href={`/series/${series.slug}`}
                prefetch={false}
              >
                {series.name} · № {ordinal}
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
  sticky = false,
  target,
}: {
  readonly className?: string;
  readonly sticky?: boolean;
  readonly target: MaterialReaderReturnTarget;
}) {
  return (
    <div className={cn(sticky && "sticky top-0 z-30 -mx-4 -mt-5 border-b border-black/6 bg-white/88 px-4 py-3 backdrop-blur-xl sm:-mx-7 sm:px-7 md:-mx-10 md:-mt-9 md:px-10", "flex min-h-11 items-center", className)}>
      <Button asChild className="min-h-11 rounded-full border-0 bg-black/5 px-3 text-xs font-semibold shadow-none" size="lg" variant="outline">
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
    <div className="mt-8 border-y border-black/8 py-2">
      <details className="group">
        <summary
          aria-label={`Содержание: ${String(items.length)}`}
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-sm font-semibold focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <List aria-hidden="true" className="size-4 text-action" />
            Содержание · {items.length}
          </span>
          <span aria-hidden="true" className="text-xs text-muted-foreground group-open:hidden">
            Открыть
          </span>
          <span aria-hidden="true" className="hidden text-xs text-muted-foreground group-open:inline">
            Скрыть
          </span>
        </summary>
        <nav aria-label="В этом материале" className="border-t border-black/8 pb-2 pt-3">
          <ul className="grid gap-2" role="list">{links}</ul>
        </nav>
      </details>
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
        <p className="mt-6 first:mt-0">
          <ReaderInline content={block.content} />
        </p>
      );
    case "heading": {
      const Heading = `h${String(block.level)}` as "h2" | "h3" | "h4";
      return (
        <Heading
          className="mt-12 scroll-mt-24 text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] text-foreground first:mt-0"
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
        <List
          className={
            block.kind === "bullet_list"
              ? "mt-6 list-disc space-y-3 pl-7 marker:text-accent"
              : "mt-6 list-decimal space-y-3 pl-7 marker:font-semibold marker:text-accent"
          }
        >
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
        <blockquote className="mt-8 border-l-4 border-accent py-1 pl-5 text-muted-foreground">
          <ReaderBlocks blocks={block.content} contentVersion={contentVersion} materialId={materialId} path={path} />
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
      return <ReaderTable block={block} contentVersion={contentVersion} materialId={materialId} path={path} />;
    case "callout":
      return (
        <aside
          aria-label={calloutLabel(block.tone)}
          className="mt-8 rounded-xl bg-secondary px-5 py-5 text-[0.9375rem] leading-7 text-secondary-foreground sm:px-6"
        >
          <p className="font-semibold">{calloutLabel(block.tone)}</p>
          <ReaderBlocks blocks={block.content} contentVersion={contentVersion} materialId={materialId} path={path} />
        </aside>
      );
    case "image":
      return (
        <div className="mt-8" data-reader-block="image">
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
        </div>
      );
    case "file":
      return (
        <div className="mt-8" data-reader-block="file">
          <MaterialAssetFile
            assetId={block.assetId}
            contentType={block.contentType}
            contentVersion={contentVersion}
            filename={block.filename}
            label={block.label}
            materialId={materialId}
            size={block.size}
          />
        </div>
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
      className="mt-8 max-w-full overflow-x-auto rounded-xl border border-border [scrollbar-color:var(--muted-foreground)_var(--muted)]"
      data-reader-block="table"
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

function textContent(content: readonly ReaderText[]): string {
  return content.map(({ text }) => text).join("");
}

function calloutLabel(tone: "note" | "tip" | "warning"): string {
  return tone === "tip" ? "Совет" : tone === "warning" ? "Важно" : "Примечание";
}
