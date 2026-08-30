import { FileText, Image as ImageIcon, Play } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type MaterialResourcePlaceholderProps =
  | {
      readonly alt: string;
      readonly caption?: string | undefined;
      readonly className?: string;
      readonly id?: string;
      readonly kind: "image";
    }
  | {
      readonly className?: string;
      readonly id?: string;
      readonly kind: "file";
      readonly label: string;
    }
  | {
      readonly caption?: string | undefined;
      readonly className?: string;
      readonly id?: string;
      readonly kind: "video";
    };

/** Presentation-neutral unavailable-resource proof shared by Reader and exact Preview. */
export function MaterialResourcePlaceholder(
  props: MaterialResourcePlaceholderProps,
) {
  switch (props.kind) {
    case "image":
      return (
        <figure className={props.className} id={props.id}>
          <div
            aria-label={props.alt}
            className="grid min-h-52 place-items-center rounded-xl bg-sidebar px-6 text-center text-sidebar-foreground"
            role="img"
          >
            <span>
              <ImageIcon aria-hidden="true" className="mx-auto mb-3 size-6 text-sidebar-primary" />
              <span className="block text-sm">{props.alt}</span>
              <span className="mt-2 block font-mono text-[0.6875rem] text-sidebar-foreground/65">
                Изображение пока недоступно для просмотра
              </span>
            </span>
          </div>
          {props.caption === undefined ? null : (
            <figcaption className="mt-3 text-sm text-muted-foreground">
              {props.caption}
            </figcaption>
          )}
        </figure>
      );
    case "file":
      return (
        <div
          className={cn(
            "flex min-h-20 items-center gap-3 rounded-xl bg-muted/60 px-4 py-4",
            props.className,
          )}
          id={props.id}
        >
          <FileText aria-hidden="true" className="size-5 shrink-0 text-accent" />
          <span>
            <span className="block text-sm font-semibold">{props.label}</span>
            <span className="mt-1 block font-mono text-[0.6875rem] text-muted-foreground">
              Файл пока недоступен для скачивания
            </span>
          </span>
        </div>
      );
    case "video":
      return (
        <figure className={props.className} id={props.id}>
          <div className="grid aspect-video place-items-center rounded-xl bg-sidebar text-sidebar-foreground">
            <span className="text-center">
              <Play aria-hidden="true" className="mx-auto mb-3 size-7 text-sidebar-primary" />
              <span className="block text-sm">Видео пока недоступно для просмотра</span>
            </span>
          </div>
          {props.caption === undefined ? null : (
            <figcaption className="mt-3 text-sm text-muted-foreground">
              {props.caption}
            </figcaption>
          )}
        </figure>
      );
  }
}
