"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMaterialReading } from "@/entities/material";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { loadPersonalHome } from "../api/personal-home.browser";
import { personalHomeQueryKey } from "../model/personal-home-contract";

export function LearningContinuation() {
  const reading = useMaterialReading();
  return !reading.resolved ? <section className="mb-10 min-h-80" aria-label="Продолжить обучение" aria-busy="true" /> : reading.accountId === null ? null : <AccountContinuation key={reading.accountId} accountId={reading.accountId} />;
}
function AccountContinuation({ accountId }: { readonly accountId: string }) {
  const query = useQuery({ queryKey: personalHomeQueryKey(accountId), queryFn: loadPersonalHome, staleTime: 0, retry: false });
  if (query.isError || query.data?.kind !== "ready") return <section className="mb-10 min-h-80" aria-label="Продолжить обучение"><p role="status">{query.isPending ? "Загружаем продолжение обучения…" : "Не удалось загрузить продолжение обучения."}</p></section>;
  return <LearningContinuationView continuation={query.data.continuation} />;
}

export function LearningContinuationView({ continuation }: { readonly continuation: { readonly series?: { readonly collection: { readonly name: string; readonly slug: string }; readonly read: number; readonly total: number } | undefined; readonly video?: { readonly material: { readonly slug: string; readonly title: string }; readonly label: string } | undefined } }) {
  const { series, video } = continuation;
  if (series === undefined && video === undefined) return <section className="mb-10 min-h-80" aria-label="Продолжить обучение"><p>Откройте материал — здесь появится продолжение обучения.</p></section>;
  return <section className="mb-10 min-h-80" aria-labelledby="account-learning">
    <h2 className="text-xl font-semibold" id="account-learning">Продолжить обучение</h2>
    <ul className="mt-4 divide-y divide-border">
      {series === undefined ? null : <li><Link className="flex min-h-20 items-center justify-between gap-4 py-4 no-underline" aria-label={`Продолжить руководство ${series.collection.name}`} href={guideProgrammeHref(series.collection.slug)}><span><strong className="block">{series.collection.name}</strong><span className="text-sm text-muted-foreground">Прочитано {series.read} из {series.total}</span></span><ArrowRight aria-hidden="true" className="size-5 shrink-0" /></Link></li>}
      {video === undefined ? null : <li><Link className="flex min-h-20 items-center justify-between gap-4 py-4 no-underline" href={materialReaderHref(video.material.slug, "/account")}><span><strong className="block">{video.material.title}</strong><span className="text-sm text-muted-foreground">{video.label}</span></span><ArrowRight aria-hidden="true" className="size-5 shrink-0" /></Link></li>}
    </ul>
  </section>;
}
