import { inlineText, type LegalBlock, type LegalInline } from "@inside/legal/markdown";
import Link from "next/link";
import type { ReactNode } from "react";

import { isInternalRoute } from "@/shared/routing/internal-route";

/**
 * Показ принятого текста. Разметка приходит уже разобранной из `@inside/legal`, поэтому здесь нет
 * ни разбора, ни правки текста: страница отвечает только за читаемость документа с телефона и
 * с компьютера. Заголовок документа приходит первым блоком и служит заголовком страницы.
 */
export function LegalDocumentView({
  blocks,
}: {
  readonly blocks: readonly LegalBlock[];
}) {
  return (
    <div className="flex flex-col gap-5 text-[0.975rem] leading-7 text-foreground">
      {blocks.map((block, index) => (
        <LegalBlockView block={block} index={index} key={`${block.kind}-${String(index)}`} />
      ))}
    </div>
  );
}

function LegalBlockView({
  block,
  index,
}: {
  readonly block: LegalBlock;
  readonly index: number;
}) {
  if (block.kind === "heading") {
    return block.level === 1 ? (
      <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
        <LegalInlineView content={block.content} />
      </h1>
    ) : (
      <h2
        className="mt-5 text-xl font-semibold tracking-[-0.02em] text-foreground md:text-2xl"
        id={`section-${String(index)}`}
      >
        <LegalInlineView content={block.content} />
      </h2>
    );
  }
  if (block.kind === "paragraph") {
    return (
      <p className="max-w-[68ch]">
        <LegalInlineView content={block.content} />
      </p>
    );
  }
  return <LegalTableView header={block.header} rows={block.rows} />;
}

type LegalTableRow = readonly (readonly LegalInline[])[];

function LegalTableView({
  header,
  rows,
}: {
  readonly header: LegalTableRow;
  readonly rows: readonly LegalTableRow[];
}) {
  // Узкий экран прокручивает таблицу вбок, поэтому область получает фокус и имя: иначе до неё
  // не добраться с клавиатуры.
  const label = header[0] === undefined ? "Таблица" : `Таблица: ${inlineText(header[0])}`;
  return (
    <div
      aria-label={label}
      className="-mx-1 overflow-x-auto px-1"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {header.map((cell, index) => (
              <th
                className="py-2 pr-4 align-top font-semibold text-foreground last:pr-0"
                key={`head-${String(index)}`}
                scope="col"
              >
                <LegalInlineView content={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="border-b border-border/60" key={`row-${String(rowIndex)}`}>
              {row.map((cell, cellIndex) => (
                <td
                  className="py-2 pr-4 align-top text-muted-foreground last:pr-0"
                  key={`cell-${String(rowIndex)}-${String(cellIndex)}`}
                >
                  <LegalInlineView content={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegalInlineView({
  content,
}: {
  readonly content: readonly LegalInline[];
}): ReactNode {
  return content.map((part, index) => {
    const key = `${part.kind}-${String(index)}`;
    if (part.kind === "strong") return <strong key={key}>{part.text}</strong>;
    if (part.kind === "code") {
      return (
        <code
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-words"
          key={key}
        >
          {part.text}
        </code>
      );
    }
    if (part.kind === "link") {
      return isInternalRoute(part.href) ? (
        <Link className="underline underline-offset-2" href={part.href} key={key}>
          {part.text}
        </Link>
      ) : (
        <a className="underline underline-offset-2" href={part.href} key={key}>
          {part.text}
        </a>
      );
    }
    return part.text;
  });
}
