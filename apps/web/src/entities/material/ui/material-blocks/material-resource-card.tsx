import { ArrowUpRight } from "lucide-react";

import { Button } from "@/shared/ui/button";

/** Адрес показан хостом: читатель видит, куда уходит, не разбирая длинную ссылку. */
function readableHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Карточка внешнего ресурса: название, пояснение и одна кнопка «Открыть». */
export function MaterialResourceCard({
  description,
  title,
  url,
}: {
  readonly description?: string | undefined;
  readonly title: string;
  readonly url: string;
}) {
  const host = readableHost(url);

  return (
    <div
      className="mt-8 rounded-xl border border-border bg-card px-5 py-5 sm:px-6"
      data-material-block="resourceCard"
    >
      <p className="font-mono text-[0.6875rem] text-muted-foreground">Ресурс</p>
      <p className="mt-2 break-words text-base font-semibold text-foreground">{title}</p>
      {description === undefined ? null : (
        <p className="mt-2 text-[0.9375rem] leading-7 text-body-muted">{description}</p>
      )}
      {host === undefined ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button asChild className="h-auto min-h-11 rounded-xl px-4 py-2">
            <a href={url} rel="noreferrer" target="_blank">
              Открыть
              <ArrowUpRight aria-hidden="true" />
            </a>
          </Button>
          <span className="break-all font-mono text-[0.6875rem] text-muted-foreground">
            {host}
          </span>
        </div>
      )}
    </div>
  );
}
