import {
  ArrowLeft,
  BookOpenText,
  FileText,
  ImageIcon,
  Play,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
  ReaderMark,
  ReaderText,
} from "@/_pages/material-reader/model/material-reader-view";
import { Button } from "@/shared/ui/button";

export interface MaterialReaderViewProps {
  readonly body: readonly ReaderBlock[];
  readonly material: MaterialReaderMetadata;
}

interface OutlineItem {
  readonly id: string;
  readonly label: string;
  readonly level: 2 | 3 | 4;
}

interface ResourceItem {
  readonly id: string;
  readonly kind: "file" | "image" | "video";
  readonly label: string;
}

/** Client-safe presentation shared by the production RSC route and Storybook. */
export function MaterialReaderView({ body, material }: MaterialReaderViewProps) {
  const outline = collectOutline(body);
  const resources = collectResources(body);

  return (
    <div className="@container/material-reader" data-material-reader-state="available">
      <ReaderBackAction />
      <div className="mt-10 min-w-0">
        <MaterialHeader material={material} />
        <ReaderOutline items={outline} />
        <article className="mt-10 min-w-0 max-w-[70ch] text-pretty text-[0.96875rem] leading-[1.7] sm:mt-12 sm:text-[1.0625rem]">
          <ReaderBlocks blocks={body} path={[]} />
        </article>
      </div>
      {resources.length > 0 ? <ReaderResources resources={resources} /> : null}
      <ReaderBackAction className="mt-16" />
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
          {material.format.name}
        </span>
        <span className="inline-flex min-h-7 items-center px-1">
          {material.topic.name}
        </span>
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
        <ul aria-label="Серии материала" className="flex flex-wrap gap-x-4 gap-y-2" role="list">
          {material.seriesMemberships.map(({ ordinal, series }) => (
            <li className="font-mono text-xs text-muted-foreground" key={series.slug}>
              {series.name} · выпуск {ordinal}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReaderBackAction({ className = "" }: { readonly className?: string }) {
  return (
    <div className={`flex min-h-11 items-center border-b border-border pb-3 ${className}`}>
      <Button asChild className="bg-background" size="lg" variant="outline">
        <Link href="/library">
          <ArrowLeft aria-hidden="true" />
          В Библиотеку
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
  path,
}: {
  readonly blocks: readonly ReaderBlock[];
  readonly path: readonly number[];
}) {
  return blocks.map((block, index) => {
    const blockPath = [...path, index];
    return <ReaderBlockView block={block} key={blockPath.join("-")} path={blockPath} />;
  });
}

function ReaderBlockView({
  block,
  path,
}: {
  readonly block: ReaderBlock;
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
              <ReaderBlocks blocks={item} path={[...path, index]} />
            </li>
          ))}
        </List>
      );
    }
    case "blockquote":
      return (
        <blockquote className="mt-6 border-l-4 border-accent pl-5 text-muted-foreground">
          <ReaderBlocks blocks={block.content} path={path} />
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
      return <ReaderTable block={block} path={path} />;
    case "callout":
      return (
        <aside
          aria-label={calloutLabel(block.tone)}
          className="mt-6 rounded-xl bg-secondary px-5 py-5 text-[0.9375rem] leading-7 text-secondary-foreground sm:px-6"
        >
          <p className="font-semibold">{calloutLabel(block.tone)}</p>
          <ReaderBlocks blocks={block.content} path={path} />
        </aside>
      );
    case "image":
      return (
        <figure className="mt-7" id={resourceId(path)}>
          <div
            aria-label={block.alt}
            className="grid min-h-52 place-items-center rounded-xl bg-sidebar px-6 text-center text-sidebar-foreground"
            role="img"
          >
            <span>
              <ImageIcon aria-hidden="true" className="mx-auto mb-3 size-6 text-sidebar-primary" />
              <span className="block text-sm">{block.alt}</span>
              <span className="mt-2 block font-mono text-[0.6875rem] text-sidebar-foreground/65">
                Изображение пока недоступно для просмотра
              </span>
            </span>
          </div>
          {block.caption ? (
            <figcaption className="mt-3 text-sm text-muted-foreground">{block.caption}</figcaption>
          ) : null}
        </figure>
      );
    case "file":
      return (
        <div
          className="mt-6 flex min-h-20 items-center gap-3 rounded-xl bg-muted/60 px-4 py-4"
          id={resourceId(path)}
        >
          <FileText aria-hidden="true" className="size-5 shrink-0 text-accent" />
          <span>
            <span className="block text-sm font-semibold">{block.label}</span>
            <span className="mt-1 block font-mono text-[0.6875rem] text-muted-foreground">
              Файл пока недоступен для скачивания
            </span>
          </span>
        </div>
      );
    case "video":
      return (
        <figure className="mt-7" id={resourceId(path)}>
          <div className="grid aspect-video place-items-center rounded-xl bg-sidebar text-sidebar-foreground">
            <span className="text-center">
              <Play aria-hidden="true" className="mx-auto mb-3 size-7 text-sidebar-primary" />
              <span className="block text-sm">Видео пока недоступно для просмотра</span>
            </span>
          </div>
          {block.caption ? (
            <figcaption className="mt-3 text-sm text-muted-foreground">{block.caption}</figcaption>
          ) : null}
        </figure>
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
  path,
}: {
  readonly block: Extract<ReaderBlock, { readonly kind: "table" }>;
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

function ReaderResources({ resources }: { readonly resources: readonly ResourceItem[] }) {
  return (
    <section aria-labelledby="reader-resources" className="mt-14 max-w-[70ch] sm:mt-16">
      <h2 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl" id="reader-resources">
        Ресурсы
      </h2>
      <ul className="mt-4 grid gap-2" role="list">
        {resources.map((resource) => {
          const Icon = resource.kind === "file" ? FileText : resource.kind === "image" ? ImageIcon : Play;
          return (
            <li key={resource.id}>
              <a
                className="flex min-h-14 items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm font-semibold no-underline hover:bg-muted"
                href={`#${resource.id}`}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" />
                {resource.label}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
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

function collectResources(
  blocks: readonly ReaderBlock[],
  path: readonly number[] = [],
): ResourceItem[] {
  return blocks.flatMap((block, index): ResourceItem[] => {
    const blockPath = [...path, index];
    if (block.kind === "file") {
      return [{ id: resourceId(blockPath), kind: "file", label: block.label }];
    }
    if (block.kind === "image") {
      return [{ id: resourceId(blockPath), kind: "image", label: block.caption ?? block.alt }];
    }
    if (block.kind === "video") {
      return [{ id: resourceId(blockPath), kind: "video", label: block.caption ?? "Видео" }];
    }
    if (block.kind === "blockquote" || block.kind === "callout") {
      return collectResources(block.content, blockPath);
    }
    if (block.kind === "bullet_list" || block.kind === "ordered_list") {
      return block.items.flatMap((item, itemIndex) =>
        collectResources(item, [...blockPath, itemIndex]),
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
