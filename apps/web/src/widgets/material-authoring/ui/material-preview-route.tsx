import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import type {
  MaterialPreviewRouteItem,
  MaterialPreviewRoutePresentation,
} from "../model/presentation";
import { publicationStateLabel } from "./publication-state-label";

type ReadyRoute = Extract<MaterialPreviewRoutePresentation, { kind: "ready" }>;

/**
 * Место материала в руководстве: где автор сейчас, соседние материалы и весь состав по главам.
 * Переходы ведут в предпросмотр, а не на страницу урока, поэтому черновики остаются закрытыми.
 */
export function MaterialPreviewRoute({
  route,
}: {
  readonly route: MaterialPreviewRoutePresentation;
}) {
  if (route.kind === "unavailable") {
    return (
      <div
        className="border-b border-border bg-card px-4 py-3 text-center text-sm text-muted-foreground sm:px-6"
        data-preview-route="unavailable"
        role="status"
      >
        Не удалось показать маршрут руководства. Сам материал показан ниже. Код
        обращения: {route.reference}
      </div>
    );
  }
  const currentSection = route.sections.find(({ items }) =>
    items.some(({ current }) => current),
  );
  return (
    <nav
      aria-label={`Маршрут руководства «${route.productName}»`}
      className="border-b border-border bg-card px-4 py-3 sm:px-6"
      data-preview-route="ready"
    >
      <div className="mx-auto w-full max-w-[80rem]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 text-sm">
            <span className="font-semibold">{route.productName}</span>
            <span className="text-muted-foreground">
              {" · "}
              {currentSection?.name == null
                ? null
                : `${currentSection.name} · `}
              материал {route.position} из {route.total}
            </span>
          </p>
          <div className="flex gap-2">
            <NeighbourButton direction="previous" item={route.previous} />
            <NeighbourButton direction="next" item={route.next} />
          </div>
        </div>
        <details className="group mt-1" data-preview-route-contents>
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium underline decoration-border underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Все материалы руководства
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="space-y-4 pb-2 pt-1">
            {route.sections.map((section, index) => (
              <section key={section.chapterId ?? "outside"}>
                {section.name === null ? null : (
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    {section.name}
                  </h2>
                )}
                {section.items.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    В главе пока нет материалов.
                  </p>
                ) : (
                  <ol
                    className="ml-6 list-decimal text-sm marker:text-muted-foreground"
                    start={
                      1 +
                      route.sections
                        .slice(0, index)
                        .reduce((count, { items }) => count + items.length, 0)
                    }
                  >
                    {section.items.map((item) => (
                      <li key={item.href}>
                        <RouteItem item={item} />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        </details>
        {route.otherProducts.length === 0 ? null : (
          <p className="pb-1 text-sm text-muted-foreground">
            Материал входит и в другие руководства:{" "}
            {route.otherProducts.map((product, index) => (
              <span key={product.href}>
                {index === 0 ? null : ", "}
                <Link
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href={product.href}
                >
                  {product.name}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    </nav>
  );
}

/** Переход к соседним материалам после чтения, с их названиями. */
export function MaterialPreviewRouteNeighbours({
  route,
}: {
  readonly route: ReadyRoute;
}) {
  if (route.previous === null && route.next === null) return null;
  return (
    <nav
      aria-label="Соседние материалы руководства"
      className="mx-auto grid w-full max-w-[72ch] gap-3 px-5 pb-14 sm:grid-cols-2 sm:px-8"
      data-preview-route-neighbours
    >
      {route.previous === null ? null : (
        <NeighbourCard direction="previous" item={route.previous} />
      )}
      {route.next === null ? null : (
        <NeighbourCard direction="next" item={route.next} />
      )}
    </nav>
  );
}

function RouteItem({ item }: { readonly item: MaterialPreviewRouteItem }) {
  const state = (
    <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
      {publicationStateLabel(item.publicationState)}
    </span>
  );
  const row = "flex min-h-11 items-center justify-between gap-3 py-1";
  return item.current ? (
    <span aria-current="page" className={cn(row, "font-semibold")}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
      {state}
    </span>
  ) : (
    <Link
      className={cn(
        row,
        "rounded-md outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
      href={item.href}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
      {state}
    </Link>
  );
}

const directionLabel = { next: "Дальше", previous: "Назад" } as const;

function NeighbourButton({
  direction,
  item,
}: {
  readonly direction: "next" | "previous";
  readonly item: MaterialPreviewRouteItem | null;
}) {
  const content = (
    <>
      {direction === "previous" ? (
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
      ) : null}
      {directionLabel[direction]}
      {direction === "next" ? (
        <ArrowRight aria-hidden="true" data-icon="inline-end" />
      ) : null}
    </>
  );
  return item === null ? (
    <Button className="min-h-11" disabled variant="outline">
      {content}
    </Button>
  ) : (
    <Button asChild className="min-h-11" variant="outline">
      <Link
        aria-label={`${directionLabel[direction]}: ${item.title}`}
        href={item.href}
      >
        {content}
      </Link>
    </Button>
  );
}

function NeighbourCard({
  direction,
  item,
}: {
  readonly direction: "next" | "previous";
  readonly item: MaterialPreviewRouteItem;
}) {
  return (
    <Link
      className={cn(
        "flex min-h-11 flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        direction === "next" && "sm:col-start-2 sm:items-end sm:text-right",
      )}
      href={item.href}
    >
      <span className="text-xs text-muted-foreground">
        {directionLabel[direction]} ·{" "}
        {publicationStateLabel(item.publicationState)}
      </span>
      <span className="font-semibold [overflow-wrap:anywhere]">
        {item.title}
      </span>
    </Link>
  );
}
