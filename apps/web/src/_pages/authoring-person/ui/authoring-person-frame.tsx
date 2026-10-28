import type { Route } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { authoringPeopleHref } from "@/shared/routing/authoring";

import "./authoring-person.css";

/**
 * Каркас карточки человека: `main` маршрута, который оболочка админки прокручивает, ссылка
 * возврата к списку и отступы. Карточка, её скелет и состояния ошибки стоят в одном каркасе,
 * поэтому приход данных не сдвигает ни возврат, ни шапку.
 */
export function AuthoringPersonFrame({
  backHref = authoringPeopleHref,
  busy = false,
  children,
  label,
  labelledBy,
}: {
  readonly backHref?: Route;
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly label?: string;
  readonly labelledBy?: string;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      className="authoring-page"
      data-authoring-person-frame
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-1 rounded-lg pe-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-person-back
          href={backHref}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />К людям
        </Link>
        {children}
      </div>
    </main>
  );
}
