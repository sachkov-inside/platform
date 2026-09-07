import { useState } from "react";

import { LibraryDiscoveryView } from "@/_pages/library-discovery";
import { LibraryPage, parseLibrarySearchParams } from "@/_pages/library";
import { MaterialReaderView, MaterialReaderAccess, MaterialReaderNotFound, type MaterialReaderMetadata, type ReaderBlock } from "@/_pages/material-reader";
import { AccountSignInRequired } from "@/_pages/account/ui/account-page";
import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import type { MaterialPreview } from "@/entities/material";
import { materials, series } from "./guest-home.fixture";

// Only fixture adapters live here. Each page below is the component used by current main.
export function ProductionGuestScene({ href }: { readonly href: string }) {
  const url = new URL(href, window.location.origin);
  const slug = url.pathname.split("/")[2];
  const returnTarget = parseMaterialReaderReturnTarget(url.searchParams.get("from") ?? "/");
  if (url.pathname === "/library") return <CatalogScene key={href} search={url.search} />;
  if (url.pathname === "/account") return <AccountSignInRequired />;
  const selectedSeries = series.find((item) => item.slug === slug);
  if (url.pathname.startsWith("/series/") && selectedSeries) {
    return <LibraryDiscoveryView returnTarget={returnTarget} result={{ kind: "ready", discoveryKind: "series", hasNext: false, reference: selectedSeries, items: selectedSeries.previewItems, relatedSeries: [], topics: [] }} />;
  }
  if (url.pathname.startsWith("/topics/")) {
    const items = materials.filter((item) => item.topicSlug === slug);
    return <LibraryDiscoveryView returnTarget={returnTarget} result={{ kind: items.length ? "ready" : "empty", discoveryKind: "topic", hasNext: false, reference: { name: items[0]?.topic ?? "Тема", slug: slug ?? "topic", summary: "Материалы по теме" }, items, relatedSeries: [], topics: [] }} />;
  }
  const material = materials.find((item) => item.slug === slug);
  if (!material) return <MaterialReaderNotFound returnTarget={returnTarget} />;
  const containingSeries = series.find((item) => item.slug === returnTarget.seriesSlug);
  const seriesContext = containingSeries ? resolveSeriesReaderContext({ currentMaterialSlug: material.slug, returnTarget, series: { kind: "ready", reference: containingSeries, items: containingSeries.previewItems } }) : null;
  const metadata = readerMetadata(material);
  return material.access === "free"
    ? <MaterialReaderView material={metadata} body={openGuideBody} primaryVideo={null} returnTarget={returnTarget} seriesContext={seriesContext} />
    : <MaterialReaderAccess material={metadata} returnTarget={returnTarget} seriesContext={seriesContext} cta={{ label: "Получить доступ", url: "/account" }} />;
}

function readerMetadata(material: MaterialPreview): MaterialReaderMetadata {
  return {
    materialId: `38000000-0000-4000-8000-${String(materials.findIndex((item) => item.slug === material.slug) + 1).padStart(12, "0")}`,
    contentVersion: 1, cover: material.cover ?? null, access: material.access,
    format: { name: material.format, slug: "guide" }, publishedAt: "2026-09-07T10:00:00Z",
    seriesMemberships: series.flatMap((item) => {
      const ordinal = item.previewItems.findIndex((entry) => entry.slug === material.slug) + 1;
      return ordinal ? [{ ordinal, series: { name: item.name, slug: item.slug } }] : [];
    }),
    slug: material.slug, title: material.title, summary: material.summary,
    tags: material.tags.map((name) => ({ name })), topic: { name: material.topic, slug: material.topicSlug },
  };
}
function CatalogScene({ search }: { readonly search: string }) {
  const [query, setQuery] = useState(() => parseLibrarySearchParams(new URLSearchParams(search)).query);
  const items = materials.filter((material) => (!query.topicSlug || query.topicSlug === material.topicSlug) && (query.formatSlugs.length === 0 || query.formatSlugs.includes(material.formatSlug)) && material.title.toLocaleLowerCase("ru").includes(query.q.toLocaleLowerCase("ru")));
  const sorted = query.sort === "title" ? [...items].sort((a, b) => a.title.localeCompare(b.title, "ru")) : items;
  return <LibraryPage query={query} onQueryChange={setQuery} result={{ kind: "ready", items: sorted, totalCount: sorted.length, nextCursor: null, facets: {
    formats: [{ id: "guide", name: "Гайд", slug: "guide", count: materials.length, summary: null }],
    series: series.map((item) => ({ ...item, id: item.slug, count: item.previewItems.length })),
    topics: Array.from(new Set(materials.map((item) => item.topicSlug))).map((slug) => { const members = materials.filter((item) => item.topicSlug === slug); return { id: slug, slug, name: members[0]?.topic ?? slug, count: members.length, summary: null }; }),
  } }} />;
}
const openGuideBody: readonly ReaderBlock[] = [
  { kind: "heading", level: 2, content: [{ kind: "text", text: "Начнём с задачи", marks: [] }] },
  { kind: "paragraph", content: [{ kind: "text", text: "Изменение может собираться на твоём компьютере и ломаться у другого разработчика. До деплоя нужно убедиться, что проект можно собрать с нуля, а изменённое поведение работает так, как задумано.", marks: [] }] },
  { kind: "heading", level: 2, content: [{ kind: "text", text: "Три проверки до деплоя", marks: [] }] },
  { kind: "paragraph", content: [{ kind: "text", text: "Установка по lock-файлу проверяет воспроизводимость зависимостей. Сборка и проверка типов обнаруживают несовместимые интерфейсы. Тест изменённого сценария проверяет поведение, которое ты обещаешь пользователю.", marks: [] }] },
  { kind: "code_block", text: "Изменение → сборка → проверка поведения → деплой" },
  { kind: "heading", level: 2, content: [{ kind: "text", text: "Попробуй на своём проекте", marks: [] }] },
  { kind: "paragraph", content: [{ kind: "text", text: "Возьми последнее изменение. Определи, какая проверка заметила бы его поломку. Если такой проверки нет, добавь её в CI и убедись, что она падает на сломанном варианте. Зелёный CI подтверждает только то, что ты проверил. Готовность приложения после деплоя проверяется отдельно.", marks: [] }] },
];
