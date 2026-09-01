import { RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";

import type { LibraryDiscoveryResult } from "../model/library-discovery-view";
import { MaterialCard } from "@/entities/material";
import { Button } from "@/shared/ui/button";

export function RelatedMaterialsSection({
  result,
  sourceSlug,
}: {
  readonly result: LibraryDiscoveryResult;
  readonly sourceSlug: string;
}) {
  if (result.kind === "unavailable" || result.kind === "not-found") {
    return (
      <section
        aria-labelledby="related-materials"
        className="mt-14 max-w-[58rem] rounded-2xl bg-muted px-5 py-6 sm:mt-16 sm:px-7"
        data-related-state="unavailable"
      >
        <h2 className="text-xl font-semibold tracking-[-0.03em]" id="related-materials">
          Похожие материалы временно недоступны
        </h2>
        <p className="mt-2 leading-7 text-muted-foreground">
          Сам материал остаётся доступен. Подборку можно загрузить повторно.
        </p>
        <Button asChild className="mt-5" size="lg" variant="outline">
          <Link href={`/materials/${sourceSlug}`}>
            <RefreshCw aria-hidden="true" />
            Повторить
          </Link>
        </Button>
      </section>
    );
  }

  if (result.kind === "empty") {
    return (
      <section
        aria-labelledby="related-materials"
        className="mt-14 max-w-[58rem] border-t border-border pt-8 sm:mt-16"
        data-related-state="empty"
      >
        <h2 className="text-xl font-semibold tracking-[-0.03em]" id="related-materials">
          Похожие материалы
        </h2>
        <p className="mt-3 max-w-[58ch] leading-7 text-muted-foreground">
          Для этого материала пока нет связанной подборки.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="related-materials"
      className="mt-14 max-w-[68rem] border-t border-border pt-8 sm:mt-16 sm:pt-10"
      data-related-state="ready"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <h2 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl" id="related-materials">
          Похожие материалы
        </h2>
      </div>
      <ul className="mt-5 grid grid-cols-1 items-stretch gap-4 @min-[42rem]/material-reader:grid-cols-2 @min-[66rem]/material-reader:grid-cols-3" role="list">
        {result.items.map((material) => (
          <li className="h-full w-full max-w-[28rem]" key={material.slug}>
            <MaterialCard headingLevel="h3" material={material} />
          </li>
        ))}
      </ul>
    </section>
  );
}
