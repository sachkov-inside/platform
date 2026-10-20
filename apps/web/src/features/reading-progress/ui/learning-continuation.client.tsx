"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMaterialReading } from "@/entities/material";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { loadPersonalHome } from "../api/personal-home.browser";
import { personalHomeQueryKey } from "../model/personal-home-contract";

export function LearningContinuation() {
  const reading = useMaterialReading();
  return !reading.resolved ? null : reading.accountId === null ? null : (
    <AccountContinuation
      key={reading.accountId}
      accountId={reading.accountId}
    />
  );
}
function AccountContinuation({ accountId }: { readonly accountId: string }) {
  const query = useQuery({
    queryKey: personalHomeQueryKey(accountId),
    queryFn: loadPersonalHome,
    retry: false,
  });
  if (query.isError || query.data?.kind !== "ready")
    return query.isPending ? null : (
      <p className="mt-6 text-sm text-muted-foreground" role="status">
        Не удалось загрузить продолжение обучения.
      </p>
    );
  return <LearningContinuationView continuation={query.data.continuation} />;
}

export function LearningContinuationView({
  continuation,
}: {
  readonly continuation: {
    readonly series?:
      | {
          readonly collection: { readonly name: string; readonly slug: string };
          readonly read: number;
          readonly total: number;
        }
      | undefined;
    readonly video?:
      | {
          readonly material: { readonly slug: string; readonly title: string };
          readonly label: string;
        }
      | undefined;
  };
}) {
  const { series, video } = continuation;
  if (series === undefined && video === undefined) return null;
  return (
    <div className="min-w-0" data-learning-continuation>
      <section
        className="rounded-xl bg-muted/40 px-5 py-4"
        aria-labelledby="account-learning"
      >
        <h2 className="text-base font-semibold" id="account-learning">
          Продолжить обучение
        </h2>
        <ul className="space-y-2">
          {series === undefined ? null : (
            <li>
              <Link
                className="flex min-h-14 items-center justify-between gap-4 rounded-lg py-2 no-underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                aria-label={`Продолжить продукт ${series.collection.name}`}
                href={productProgrammeHref(series.collection.slug)}
              >
                <span className="min-w-0">
                  <strong className="line-clamp-2 text-sm font-semibold sm:text-base">
                    {series.collection.name}
                  </strong>
                  <span className="block text-xs text-muted-foreground">
                    Прочитано {series.read} из {series.total}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
              </Link>
            </li>
          )}
          {video === undefined ? null : (
            <li>
              <Link
                className="flex min-h-14 items-center justify-between gap-4 rounded-lg py-2 no-underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                href={materialReaderHref(video.material.slug, "/account")}
              >
                <span className="min-w-0">
                  <strong className="line-clamp-2 text-sm font-semibold sm:text-base">
                    {video.material.title}
                  </strong>
                  <span className="block text-xs text-muted-foreground">
                    {video.label}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
              </Link>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
