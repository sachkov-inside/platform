"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Code2, Terminal } from "lucide-react";
import Link from "next/link";

import { useMaterialReading } from "@/entities/material";
import { AiFirstProcessArtwork, aiFirstGuide } from "@/features/ai-first-guide";
import { formatMaterialCount } from "@/features/library-discovery";
import { loadSeriesContinuation, seriesContinuationQueryKey } from "@/features/reading-progress";
import { collectionDiscoveryHref, materialReaderHref } from "@/shared/routing/material-reader";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";
import type { HomeCollection } from "../model/home-view";

export function FeaturedGuide({ series }: { readonly series: HomeCollection }) {
  if (series.slug === aiFirstGuide.slug) return <section className="home-guide home-guide-featured-ai" aria-labelledby="featured-title">
    <div className="home-guide-copy">
      <p className="home-guide-eyebrow">Практикум</p>
      <h2 id="featured-title">{series.name}</h2>
      <p className="home-guide-subtitle">Инженерная работа с агентами</p>
      {series.summary && <p className="home-guide-summary">{series.summary}</p>}
      <div className="home-guide-actions">
        <span>{formatMaterialCount(series.count)}</span>
        <Link className="home-guide-open" href={collectionDiscoveryHref("series", series.slug, "/")}>Открыть практикум <ArrowRight aria-hidden="true" /></Link>
        <GuideContinuation slug={series.slug} />
      </div>
    </div>
    <div className="home-guide-visual">
      <div className="home-guide-animation home-guide-ai"><AiFirstProcessArtwork /></div>
      <div className="home-guide-mobile-footer"><span>{formatMaterialCount(series.count)}</span><ArrowRight aria-hidden="true" /><Link href={collectionDiscoveryHref("series", series.slug, "/")} aria-label="Открыть практикум">Открыть</Link></div>
    </div>
  </section>;
  return <section className="home-guide" aria-labelledby="featured-title">
    <div className="home-guide-copy">
      <h2 id="featured-title">{series.name}</h2>
      {series.summary && <p>{series.summary}</p>}
      <div className="home-guide-actions">
        <span>{formatMaterialCount(series.count)}</span>
        <Link className="home-guide-open" href={collectionDiscoveryHref("series", series.slug, "/")}>Открыть руководство <ArrowRight aria-hidden="true" /></Link>
        <GuideContinuation slug={series.slug} />
      </div>
    </div>
    <div className="home-guide-animation">
      <div className="home-guide-scenes" aria-hidden="true">
        <div className="home-guide-scene home-guide-scene-task"><Terminal /><p>Собрать приложение.<br />От идеи до запуска.</p><div className="home-guide-prompt">Разберёмся с требованиями<ArrowRight /></div></div>
        <div className="home-guide-scene home-guide-scene-agent"><Code2 /><p>Планируем.<br />Пишем. Разбираемся.</p><div className="home-guide-code"><i /><i /><i /><i /></div></div>
        <div className="home-guide-scene home-guide-scene-checks"><Check /><p>Код работает.<br />Теперь проверим почему.</p><ul><li><Check /> Тесты</li><li><Check /> Ревью</li><li><Check /> Сборка</li></ul></div>
        <div className="home-guide-scene home-guide-scene-app"><div className="home-guide-app"><div><span /><span /><span /></div><strong>Приложение запущено</strong><p>От задачи — к результату</p><div className="home-guide-app-content"><Check /> Всё готово к следующему шагу</div></div></div>
      </div>
      <div className="home-guide-animation-caption"><span>Задача → агент → проверки → приложение</span></div>
    </div>
  </section>;
}

function GuideContinuation({ slug }: { readonly slug: string }) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : null;
  return <div className="home-guide-continue">{accountId === null ? null : <AccountGuideContinuation key={accountId} accountId={accountId} slug={slug} />}</div>;
}

function AccountGuideContinuation({ accountId, slug }: { readonly accountId: string; readonly slug: string }) {
  const query = useQuery({ queryKey: seriesContinuationQueryKey(accountId, slug), queryFn: () => loadSeriesContinuation(slug), staleTime: 0, retry: false });
  const continuation = !query.isError && query.data?.kind === "ready" ? query.data.continuation : null;
  return continuation === null ? null : <Link href={materialReaderHref(continuation.materialSlug, guideProgrammeHref(slug))}>Продолжить обучение <ArrowRight aria-hidden="true" /></Link>;
}
