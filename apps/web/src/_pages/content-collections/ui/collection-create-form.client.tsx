"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { authoringProductEditorHref } from "@/shared/routing/authoring";
import { Button } from "@/shared/ui/button";

import { createContentCollection } from "../api/content-collections.browser";
import type {
  ContentCollectionKind,
  ContentCollectionMutationResult,
} from "../model/content-collections";
import { MutationNotice } from "./collection-mutation-notice";

/**
 * Форма новой темы или продукта под заголовком списка. Новая тема встаёт в список, новый продукт
 * открывается на своей странице.
 */
export function CollectionCreateForm({
  kind,
  onCreated,
}: {
  readonly kind: ContentCollectionKind;
  readonly onCreated: (result: ContentCollectionMutationResult) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const createMutation = useMutation({
    mutationFn: createContentCollection,
    onSuccess: (result) => {
      if (result.kind !== "saved") return;
      setName("");
      setSlug("");
      setSummary("");
      onCreated(result);
      if (kind === "product")
        router.push(authoringProductEditorHref(result.collection.id));
    },
  });
  return (
    <section
      aria-label={kind === "topic" ? "Создать тему" : "Создать продукт"}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate({ kind, name, slug, summary });
        }}
      >
        <CollectionField label="Название">
          <input
            className={collectionFieldClassName}
            maxLength={120}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            required
            value={name}
          />
        </CollectionField>
        <CollectionField hint="После создания не меняется" label="Адрес">
          <input
            className={collectionFieldClassName}
            maxLength={120}
            onChange={(event) => {
              setSlug(event.currentTarget.value);
            }}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="platform-engineering"
            required
            value={slug}
          />
        </CollectionField>
        <CollectionField className="sm:col-span-2" label="Краткое описание">
          <textarea
            className={`${collectionFieldClassName} min-h-20 py-3`}
            maxLength={500}
            onChange={(event) => {
              setSummary(event.currentTarget.value);
            }}
            value={summary}
          />
        </CollectionField>
        <div className="sm:col-span-2">
          <Button disabled={createMutation.isPending} type="submit">
            {createMutation.isPending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Создать
          </Button>
        </div>
      </form>
      <MutationNotice
        onRefresh={() => {
          router.refresh();
        }}
        result={createMutation.data ?? null}
      />
    </section>
  );
}

export function CollectionField({
  children,
  className,
  hint,
  label,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly hint?: string;
  readonly label: string;
}) {
  return (
    <label className={className}>
      <span className="text-sm font-semibold">{label}</span>
      {hint === undefined ? null : (
        <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
      )}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export const collectionFieldClassName =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";
