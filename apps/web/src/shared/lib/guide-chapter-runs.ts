/**
 * A Guide Chapter owns one continuous run of the main path. This splits an ordered composition
 * into those runs in their real order, keeps Materials outside every chapter where they are, and
 * places a chapter that holds nothing after the last preceding chapter that does.
 */
export function guideChapterRuns<Item, Chapter extends { readonly id: string }>(
  items: readonly Item[],
  chapters: readonly Chapter[],
  chapterIdOf: (item: Item) => string | null,
): readonly {
  readonly chapter: Chapter | null;
  readonly items: readonly Item[];
  readonly offset: number;
}[] {
  const runs: { chapterId: string | null; items: Item[]; offset: number }[] = [];
  for (const [offset, item] of items.entries()) {
    const chapterId = chapterIdOf(item);
    const current = runs.at(-1);
    if (current !== undefined && current.chapterId === chapterId) current.items.push(item);
    else runs.push({ chapterId, items: [item], offset });
  }

  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const filled = new Set(runs.flatMap(({ chapterId }) => (chapterId === null ? [] : [chapterId])));
  const pending = chapters.filter(({ id }) => !filled.has(id));
  const sections: {
    chapter: Chapter | null;
    items: readonly Item[];
    offset: number;
  }[] = [];
  for (const run of runs) {
    if (run.chapterId !== null) {
      const position = chapters.findIndex(({ id }) => id === run.chapterId);
      while (
        pending.length > 0 &&
        chapters.findIndex(({ id }) => id === (pending[0]?.id ?? "")) < position
      ) {
        const empty = pending.shift();
        if (empty !== undefined) sections.push({ chapter: empty, items: [], offset: run.offset });
      }
    }
    sections.push({
      chapter: run.chapterId === null ? null : byId.get(run.chapterId) ?? null,
      items: run.items,
      offset: run.offset,
    });
  }
  for (const empty of pending) sections.push({ chapter: empty, items: [], offset: items.length });
  return sections;
}
