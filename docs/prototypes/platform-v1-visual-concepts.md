# Platform v1 visual concepts

Статус: **checkpoint 1 — shell, navigation и Library/search** для
[Platform issue #22](https://github.com/sachkov-inside/platform/issues/22). Это decision artifact
throwaway prototype branch, а не production UI contract или component-library selection.

Runnable route: `/prototype/visual-concepts?variant=workshop`. Стрелки переключают concepts и
сохраняют variant в URL; `←` / `→` работают вне editable controls. Переключатель состояния показывает
один и тот же populated или empty Library fixture. Запуск из repository root: `pnpm dev:web`.

## Design question и staged boundary

Какой visual language и shell лучше поддерживает самостоятельный поиск реального Inside content,
а затем выдержит long-form Material и owner authoring без превращения Platform в generic dashboard,
LMS или documentation portal?

Checkpoint 1 сравнивает три полноценные Library compositions. После owner review те же concepts
расширяются на один и тот же F2 Material и author editor/Preview; окончательный выбор до этого не
фиксируется. shadcn/ui, 21st.dev и другие component sources оцениваются в #23 по доказанным
component needs, а не выбирают visual direction заранее.

Во всех concepts один и тот же query ищет по title, summary, Topic, Format, Series и canonical tags.
Facets `Тема / Формат / Серия` поддерживают OR между несколькими values внутри одного facet и AND
между facets, сохраняют search query, показывают active-filter summary и имеют явный reset. Result
count выводится из отфильтрованного списка: populated fixture даёт три материала, а empty state —
`0 материалов`; недоказанные activity и taxonomy counts в UI не используются.

## Concept contracts

### H1 — Soft Technical Workshop (`variant=workshop`)

- **Palette:** canvas `#F7F4ED`, surface `#FFFCF6`, ink `#20201E`, muted `#69665F`, signal orange
  `#E7652F`, charcoal workbench `#292927`.
- **Type:** Manrope for display hierarchy, Onest for body/UI, IBM Plex Mono only for status,
  measurements and technical metadata.
- **Structure:** persistent compact desktop rail becomes bottom navigation on mobile; a task-led
  search opening feeds an editorial result list rather than a card grid.
- **Rhythm/density:** moderate; `4.5rem` shell rhythm, `12.5rem` result rows, generous reading copy
  inside denser technical metadata.
- **Signature:** one orange signal path connects current/new/access state through the result list.
- **Generic-template test:** the warm canvas plus orange is an acknowledged danger. The revision
  removes ornamental retro imagery and makes orange carry only observable state; content rows and
  the delivery signal replace dashboard cards.

### H2 — Living Knowledge Atlas (`variant=atlas`)

- **Palette:** canvas `#EEF5EF`, surface `#F9FCF8`, deep green ink `#173C37`, muted `#5A706C`, route
  green `#087F68`, action/state copper `#D46A3A`.
- **Type:** Onest for display/body/UI and IBM Plex Mono for counts and route coordinates.
- **Structure:** floating global header, sticky relationship navigator and a route-ordered result
  stream; mobile moves global navigation to the bottom and puts the context map inline.
- **Rhythm/density:** denser discovery, with compact paths next to relaxed result summaries.
- **Signature:** a contextual path makes Topic → search concept → Series → Material relationships
  visible and actionable without inventing progress.
- **Generic-template test:** a sidebar plus cards would collapse into a generic knowledge tool. The
  revision uses semantic links, route continuity and one results surface; the map represents real
  Platform relationships and disappears where it would obstruct mobile reading.

### H3 — Quiet Content Studio (`variant=studio`)

- **Palette:** cool paper `#F5F7F6`, ink `#1D2828`, muted `#64706E`, hairline `#CBD4D1`, state teal
  `#0C6F78`, one family signal `#D75A32`, neutral wash `#E6ECE9`.
- **Type:** Literata for the editorial voice and long-form preview, Onest for controls, IBM Plex
  Mono for counts and access metadata.
- **Structure:** no persistent desktop rail; a typographic library index, horizontal filter shelf
  and three-column editorial entries collapse into document order on mobile.
- **Rhythm/density:** spacious reading-first cadence with strict hairline sections and almost no
  elevated containers.
- **Signature:** the same editorial canvas is designed to become reader and author Preview later,
  with controls entering the margins rather than replacing the content language.
- **Generic-template test:** the initial warm paper/serif pass reproduced a common AI editorial
  default. The revision moves to a cool technical paper, reserves one warm family signal for the
  wordmark, and keeps Inside-specific technical copy and exact access language; the next checkpoint
  must still prove recognizability in video and authoring.

## External concept-seed audit

The mandatory direction roll (`130e7475`) assigned the third grounded candidate, which reinforced
the need to make H3 a committed visual system rather than a weak neutral fallback. The brief still
requires all three H1/H2/H3 concepts, so the roll does not replace owner-calibrated hypotheses.

| Challenger form | Verdict | Discipline retained |
|---|---|---|
| Alphabet storm | Declined | Typography must behave as structure, not decoration |
| Iridescent cloud edge | Declined | State color stays on a narrow semantic edge |
| Variable-font specimen | Competitive on audience identification | Strong scale contrast and live coordinates raise H3 typography |
| Split-flap concourse | Competitive on scanability, weaker on calm | Stable columns and visible state change raise H1/H2 result rhythm |
| Cassette deck fascia | Declined | One active signal channel raises H1 without importing retro chrome |
| CD-ROM console | Declined | Controls need tactile state travel, but fixed-console topology conflicts with reading |

## Checkpoint 1 evidence

- Desktop: [H1 Workshop](../evidence/issue-22/checkpoint-1/workshop-desktop.png),
  [H2 Atlas](../evidence/issue-22/checkpoint-1/atlas-desktop.png),
  [H3 Studio](../evidence/issue-22/checkpoint-1/studio-desktop.png).
- Narrow mobile viewport slices: [H1 shell](../evidence/issue-22/checkpoint-1/workshop-mobile.png) /
  [results](../evidence/issue-22/checkpoint-1/workshop-mobile-results.png),
  [H2 shell](../evidence/issue-22/checkpoint-1/atlas-mobile.png) /
  [results](../evidence/issue-22/checkpoint-1/atlas-mobile-results.png),
  [H3 shell](../evidence/issue-22/checkpoint-1/studio-mobile.png) /
  [results](../evidence/issue-22/checkpoint-1/studio-mobile-results.png), and
  [empty results](../evidence/issue-22/checkpoint-1/empty-mobile.png). Fixed bottom navigation is
  shown only at the viewport edge; no full-page mobile capture relocates it into document content.
- `axe-core 4.13.0`: zero violations on all three populated variants; therefore zero
  serious/critical findings.
- Keyboard smoke: skip link → global navigation → search → filters → Material links; prototype
  arrows are additionally available outside editable controls in development.
- 200% text zoom at a 390 CSS-pixel viewport: no document horizontal overflow and all visible
  search/state controls retain non-zero layout boxes in all three variants.
- `impeccable` detector: no findings on the prototype route, switcher or CSS module.
- Repository checks: ESLint, recursive TypeScript, backend tests, recursive builds and
  `git diff --check` pass.

Owner notes on shell, navigation, density and recognizability are the only remaining input before
Material/editor expansion.
