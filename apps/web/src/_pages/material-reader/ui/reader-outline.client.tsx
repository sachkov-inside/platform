"use client";

import { List } from "lucide-react";
import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";
import styles from "./reader-outline.module.css";

export interface ReaderOutlineItem {
  readonly id: string;
  readonly label: string;
  readonly level: 2 | 3 | 4;
}

/** The disclosure and study action remain separate keyboard controls. */
export function ReaderOutline({
  items,
  readingAction,
}: {
  readonly items: readonly ReaderOutlineItem[];
  readonly readingAction?: ReactNode;
}) {
  if (items.length === 0 && readingAction == null) return null;
  return (
    <Collapsible.Root className={styles["root"]} data-reader-outline>
      <div className={styles["row"]}>
        {items.length === 0 ? (
          <span />
        ) : (
          <Collapsible.Trigger
            aria-label={`Содержание: ${String(items.length)}`}
            className={styles["trigger"]}
          >
            <List aria-hidden="true" className="size-4 shrink-0 text-action" />
            <span>Содержание · {items.length}</span>
          </Collapsible.Trigger>
        )}
        {readingAction == null ? null : (
          <div
            className={styles["study"]}
            role="group"
            aria-label="Отметка изучения"
            data-reader-study-controls
          >
            {readingAction}
          </div>
        )}
      </div>
      <Collapsible.Content>
        <nav aria-label="В этом материале" className={styles["links"]}>
          <ul className="grid gap-2" role="list">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
                  href={`#${item.id}`}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
