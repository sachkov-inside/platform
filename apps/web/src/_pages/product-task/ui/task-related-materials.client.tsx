"use client";

import { ArrowRight, Circle, CircleCheck, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import type { Route } from "next";

import { useMaterialReading } from "@/entities/material";
import { internalRoute } from "@/shared/routing/internal-route";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import type { OpenProductTask } from "../model/product-task-page";

type RelatedMaterial = OpenProductTask["relatedMaterials"][number];

/** Retain authored query values and fragments while the selected course owns the return target. */
export function taskRelatedMaterialHref(
  slug: string,
  returnTo: Route,
  authoredHref?: Route,
): Route {
  const readerHref = materialReaderHref(slug, returnTo);
  if (authoredHref === undefined) return readerHref;
  const target = new URL(authoredHref, "https://inside.invalid");
  target.searchParams.set("from", returnTo);
  return internalRoute(`${target.pathname}${target.search}${target.hash}`);
}

/** Known Material IDs join the existing Account-scoped batch and cache; unknown state stays unknown. */
export function TaskRelatedMaterialLink({
  material,
  returnTo,
  authoredHref,
  children,
}: {
  readonly material: RelatedMaterial;
  readonly returnTo: Route;
  readonly authoredHref?: Route;
  readonly children: ReactNode;
}) {
  const { state, accountId, resolved, failed } = useMaterialReading(
    material.materialId,
  );
  const isRead = state?.isRead === true;
  const ProgressIcon = isRead ? CircleCheck : Circle;
  return (
    <IntentPrefetchLink
      className="inline-flex min-h-11 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-3 py-2 text-sm no-underline hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      href={taskRelatedMaterialHref(material.slug, returnTo, authoredHref)}
      data-task-related-material={material.materialId}
    >
      <span className="min-w-0 flex-1 leading-6 [overflow-wrap:anywhere]">
        {children}
      </span>
      {resolved && accountId !== null ? (
        state === undefined ? (
          <span className="text-xs text-muted-foreground">
            {failed ? "Прогресс недоступен" : "Прогресс уточняется"}
          </span>
        ) : (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            data-task-related-read={isRead}
          >
            <ProgressIcon aria-hidden="true" className="size-4" />
            {isRead ? "Изучено" : "Не изучено"}
          </span>
        )
      ) : null}
      {material.availability === "available" ? (
        <ArrowRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : (
        <>
          <LockKeyhole
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">
            {material.availability === "locked"
              ? "Нужен доступ"
              : "Доступ уточняется"}
          </span>
        </>
      )}
    </IntentPrefetchLink>
  );
}

export function TaskRelatedMaterials({
  materials,
  returnTo,
  headingId,
}: {
  readonly materials: readonly RelatedMaterial[];
  readonly headingId: string;
  readonly returnTo: Route;
}) {
  return materials.length === 0 ? null : (
    <section aria-labelledby={headingId} className="mb-8">
      <h2 id={headingId} className="text-xl font-semibold tracking-[-0.015em]">
        Материалы к заданию
      </h2>
      <ul className="mt-3 grid gap-2">
        {materials.map((material) => (
          <li key={material.materialId}>
            <TaskRelatedMaterialLink material={material} returnTo={returnTo}>
              {material.title}
            </TaskRelatedMaterialLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
