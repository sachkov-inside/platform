"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import type { Route } from "next";

export const cardVariants = [
  { key: "A", name: "Линия через номера" },
  { key: "B", name: "Ссылки между гайдами" },
  { key: "C", name: "Схема последовательности" },
] as const;

/** Throwaway #301 comparison controls; never ship with the selected design. */
export function PrototypeSwitcher() {
  const query = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const index = Math.max(0, cardVariants.findIndex(({ key }) => key === query.get("variant")));
  const choose = useCallback((next: number) => {
    const params = new URLSearchParams(query.toString());
    params.set("variant", cardVariants[(next + cardVariants.length) % cardVariants.length]!.key);
    router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
  }, [pathname, query, router]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]"))) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      choose(index + (event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [choose, index]);
  if (process.env.NODE_ENV === "production") return null;
  return (
    <aside aria-label="Сравнение связи между гайдами" className="fixed bottom-24 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-white/20 bg-primary p-3 text-white shadow-xl md:bottom-6">
      <p aria-live="polite" className="mb-2 text-center text-xs font-semibold">{cardVariants[index]!.key} · {cardVariants[index]!.name}</p>
      <div className="flex items-center justify-between gap-2">
        <button aria-label="Предыдущий вариант" className="grid size-10 place-items-center rounded-xl hover:bg-white/15 focus-visible:outline-2" onClick={() => choose(index - 1)}><ArrowLeft className="size-4" /></button>
        <div className="flex gap-2">{cardVariants.map(({ key, name }, i) => <button key={key} aria-label={`${key} — ${name}`} aria-pressed={i === index} onClick={() => choose(i)} className={`min-h-10 min-w-12 rounded-xl text-sm font-bold focus-visible:outline-2 ${i === index ? "bg-white text-primary" : "hover:bg-white/15"}`}>{key}</button>)}</div>
        <button aria-label="Следующий вариант" className="grid size-10 place-items-center rounded-xl hover:bg-white/15 focus-visible:outline-2" onClick={() => choose(index + 1)}><ArrowRight className="size-4" /></button>
      </div>
    </aside>
  );
}
