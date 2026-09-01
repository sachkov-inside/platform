"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { formatMaterialCount } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export function TopicMaterialCatalog({
  hasNext,
  items,
  topicSlug,
}: {
  readonly hasNext: boolean;
  readonly items: readonly MaterialPreview[];
  readonly topicSlug: string;
}) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("all");
  const [playlist, setPlaylist] = useState("all");
  const [sort, setSort] = useState("default");
  const formats = unique(items.map((material) => material.format));
  const playlists = uniqueBySlug(items.flatMap((material) => material.seriesMemberships));
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    const filtered = items.filter(
      (material) =>
        (normalized.length === 0 ||
          [material.title, material.summary, ...material.tags]
            .join(" ")
            .toLocaleLowerCase("ru")
            .includes(normalized)) &&
        (format === "all" || material.format === format) &&
        (playlist === "all" ||
          material.seriesMemberships.some(({ slug }) => slug === playlist)),
    );
    return sort === "title"
      ? [...filtered].sort((left, right) => left.title.localeCompare(right.title, "ru"))
      : filtered;
  }, [format, items, playlist, query, sort]);
  const active = query.length > 0 || format !== "all" || playlist !== "all";

  return (
    <section aria-labelledby="topic-materials" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em]" id="topic-materials">Материалы</h2>
          <p aria-live="polite" className="mt-1 font-mono text-xs text-muted-foreground">{formatMaterialCount(visible.length)}</p>
        </div>
      </div>
      <form className="mt-5 rounded-2xl bg-muted/75 p-4" onSubmit={(event) => { event.preventDefault(); }}>
        <div className="grid gap-3 @min-[52rem]/discovery:grid-cols-[minmax(0,1fr)_12rem]">
          <label>
            <span className="mb-2 block text-sm font-semibold">Поиск по материалам темы</span>
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input className="min-h-12 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" maxLength={120} onChange={(event) => { setQuery(event.currentTarget.value); }} placeholder="Название, описание, тег" type="search" value={query} />
            </span>
          </label>
          <label>
            <span className="mb-2 block text-sm font-semibold">Сортировка</span>
            <Select onValueChange={setSort} value={sort}>
              <SelectTrigger className="min-h-12 w-full bg-card"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="default">По умолчанию</SelectItem><SelectItem value="title">По названию</SelectItem></SelectContent>
            </Select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2 font-semibold"><SlidersHorizontal aria-hidden="true" className="size-4" />Фильтры</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <CatalogSelect label="Формат" onChange={setFormat} options={formats.map((value) => ({ label: value, value }))} value={format} />
          <CatalogSelect label="Плейлист" onChange={setPlaylist} options={playlists.map(({ name, slug }) => ({ label: name, value: slug }))} value={playlist} />
        </div>
        {active ? <Button className="mt-3" onClick={() => { setQuery(""); setFormat("all"); setPlaylist("all"); }} type="button" variant="ghost">Сбросить поиск и фильтры</Button> : null}
      </form>
      {visible.length === 0 ? (
        <div className="mt-5 rounded-2xl bg-muted px-5 py-8 text-center"><h3 className="text-lg font-semibold">Ничего не найдено</h3><p className="mt-2 text-sm text-muted-foreground">Измените поиск или фильтры.</p></div>
      ) : (
        <ul className="mt-5 grid grid-cols-1 items-stretch justify-items-center gap-4 @min-[40rem]/discovery:grid-cols-2 @min-[68rem]/discovery:grid-cols-3" role="list">
          {visible.map((material) => <li className="h-full w-full max-w-[28rem]" key={material.slug}><MaterialCard headingLevel="h3" material={material} /></li>)}
        </ul>
      )}
      {hasNext ? <Button asChild className="mt-6" variant="outline"><Link href={`/library?topic=${encodeURIComponent(topicSlug)}`}>Показать все материалы</Link></Button> : null}
    </section>
  );
}

function CatalogSelect({ label, onChange, options, value }: { readonly label: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly label: string; readonly value: string }[]; readonly value: string }) {
  return (
    <label><span className="mb-2 block font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span><Select onValueChange={onChange} value={value}><SelectTrigger className="min-h-11 w-full bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все</SelectItem>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>
  );
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "ru"));
}

function uniqueBySlug<T extends { readonly name: string; readonly slug: string }>(values: readonly T[]): readonly T[] {
  return [...new Map(values.map((value) => [value.slug, value])).values()];
}
