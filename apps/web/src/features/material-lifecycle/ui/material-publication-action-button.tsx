"use client";

import { CloudOff, Send, LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/shared/ui/button";

type PublicationOperation = "publish" | "unpublish";

export function MaterialPublicationActionButton({
  operation,
  pending = false,
  ...buttonProps
}: Omit<ComponentProps<typeof Button>, "children"> & {
  readonly operation: PublicationOperation;
  readonly pending?: boolean;
}) {
  const label =
    operation === "publish"
      ? pending
        ? "Публикуем…"
        : "Опубликовать"
      : pending
        ? "Снимаем…"
        : "Снять с публикации";
  return (
    <Button {...buttonProps}>
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          data-icon="inline-start"
        />
      ) : operation === "publish" ? (
        <Send aria-hidden="true" data-icon="inline-start" />
      ) : (
        <CloudOff aria-hidden="true" data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}
