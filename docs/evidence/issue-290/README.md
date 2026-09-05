# #290 — Home hub and Series proof

The owner selected the latest A (hub + subscription) on 2026-09-05 and delegated the bounded
local product/visual completion. Public wording is **Серии**. This proof hands that direction to
[implementation #295](https://github.com/sachkov-inside/platform/issues/295); it is not permission
to merge or publish. The rejected landing variants remain in history, not a new A/B decision.

Sources: [#290](https://github.com/sachkov-inside/platform/issues/290),
[Workspace PR115](https://github.com/sachkov-inside/workspace/pull/115), and the coordinator's
explicit ordered-composition clarification on 2026-09-05, also recorded in #295. The latter
supersedes the intermediate proposal for four members with a separate A → B navigation path.
Fixed review base: `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`.

## Selected composition

Home retains the accepted shell, colors, typography, material cards and note feed. Its order is:
section shortcuts/search → compact invitation for visitors → **Серии** → compact topic filters →
new videos → fresh guides and related context → notes. Members do not see the invitation.
On mobile, Series form a horizontal rail with a visible next card; all Series remain accessible
through «Все серии». Topics are secondary filters, not competing learning paths.

The first two featured Series are the two-guide path and the chronological development diary.
The full sample catalog also exposes a mixed test Series. Library, format/topic filters, title/
description search and direct Material opening remain available. No Course/Product entity,
separate Series purchase, progress tracking or Workshop is introduced.

## One explicit order, no hidden membership roles

`series-order.fixture.ts` is the single source of sample membership and order. Memberships in
material previews are derived from it. The reader visits each next entry, labelled
«Следующий материал». It never infers a role from format, dates or a sorting convention.

| Series | Exact ordered composition | Next after guide A |
|---|---|---|
| Как организовать harness для проекта | A, B | B |
| Проверка работы агента — mixed test | A, video 5, illustrative note | video 5 |
| Разработка платформы — video diary | episodes 1–8 | A is not a member |

Video 5 participates in both the mixed test Series and the diary. Its next is the note in the
former, episode 6 in the latter, and none when opened independently. Guide A also belongs to two
Series. The second illustrative note belongs to zero Series. Opening from Library selects none;
entering from Series preserves that specific context; selectors offer only actual memberships.

Video 5 and the note shown beside the A/B steps are **ordinary related links outside that
Series' composition**. They open independently. If an author includes them in a Series, as the
mixed sample does, they become normal sequence entries. There is no `main`/`optional` membership
field. The video association is explicitly a hypothesis based on its Telegram description;
no reviewed transcript or timestamp is claimed. The guides can be read without watching it.

## Run and reproduce

Run `pnpm storybook` or the repository Storybook Compose profile. Entries are under
`Pages / Inside showcase 290`; `src/workshop` stays outside production imports.
The existing B story is only a historical main-composition reference, not a candidate direction.
No switcher invites another A/B choice. URLs below are relative to the chosen Storybook port.

- Home: `/iframe.html?id=pages-inside-showcase-290--value-first&viewMode=story`
- Guide Series: `/iframe.html?id=pages-inside-showcase-290--guide-series&viewMode=story`
- Mixed Series: `/iframe.html?id=pages-inside-showcase-290--mixed-series&viewMode=story`
- Diary: `/iframe.html?id=pages-inside-showcase-290--video-series&viewMode=story`
- Catalog: `/iframe.html?id=pages-inside-showcase-290--hub-library-catalog&viewMode=story`
- Independent A: `/iframe.html?id=pages-inside-showcase-290--free-guide&viewMode=story`
- Locked/member B: `--locked-guide` / `--member-guide` under the same story prefix.

Query state holds screen, Series context, episode, membership preview and catalog filters.
Search text is temporary and resets when leaving the sample catalog. The expandable proof panel
below the content controls member state; Agentation stays enabled during visual review.

## Promotion mapping for #295

No new workshop file is production-ready code. Reuse the established modules; adapt the bounded
presentation below into owning production slices with real adapters and operational states.
Never import this proof, its fixtures, mock URL router or development access switch into production.

| Proof / input | Production owner and disposition |
|---|---|
| `HomeHub({home: HomeView, member, membershipHref})` in `home-hub.prototype.tsx` | Adapt layout into `_pages/home`; keep server adapter and `HomeResult` availability handling. Supply effective membership from the real account/access projection. |
| Existing `MaterialCard`, `ContentCoverImage`, `PublicSectionHeading`, `ApplicationShell`, `PublicProductHeader`, `Button` | Already production-owned; reuse their public interfaces and accepted tokens. |
| `SeriesCard` in `series-card.prototype.tsx` | Isolated copy of accepted `PlaylistCard` with public «Серия» wording; promote the wording in owning `features/library-discovery` rather than shipping a parallel card. Current presentation interface remains count/name/summary/cover/previews/slug. |
| `Series()`, `Related()`, `SequenceNavigation()` in parent prototype | Adapt into existing Series discovery and Material reader slices. Load explicit ordered members and validated selected Series context through real adapters. Related content uses ordinary authored links. |
| `series-order.fixture.ts`, `hub.fixture.ts`, `content.fixture.ts` | Storybook/development samples only. No real editorial content or authoring pipeline. |
| `HubLibrary`, `HubNote`, local `href/navigate/intercept` | Navigation demonstration only. Keep production Library search/filter ownership and actual reader renderer; do not promote these substitutes. |
| CSS `.hsg-hub-*`, `.hsg-topic-filters`, `.hsg-related` | Bounded visual reference for production composition. Reader generic typography is prototype CSS; preserve production rich text renderer. |

**Summary only:** Series task, audience, prerequisites, result and limits can all be expressed in
its existing `summary`, displayed with name and count. The proof does not require dedicated
outcome/audience/section/role fields. Use current Series order and Material relations. Preserve
0/1/N membership, selected-context navigation and publication/access/archive checks in #295.

The accepted #271 cover assets are already served by the existing Storybook/static cover setup
(`27100000-0000-4000-8000-…`). Reuse their existing fixture mapping for visual checks, not these
fixture IDs as production catalog data. No new art assets or content rights are introduced.

## Evidence and checks

Responsive screenshots in [images](images/) are source-controlled evidence, not generated mocks.
The final verification result is recorded with the proof commit in its PR and #290 handoff.

- [Home desktop](images/home-desktop.png)
- [Series desktop](images/series-desktop.png)

Pinned Storybook checks during iteration: web typecheck, focused oxlint, docs contract, web
architecture/negative guardrails and Storybook build passed. An early full check in the Alpine
Storybook runtime stopped in tooling because `bash` was absent; that environment is insufficient
for the root gate. A full check is being run using the pinned host Node/pnpm contract with bash
and Go, and the PR runs the repository CI gate. Do not equate the earlier partial run with a pass.

## Boundaries and states still owned by #295

Eight video source descriptions come from the brief's Telegram evidence; playback is a labelled
placeholder. A/B are planned guide samples, with A explicitly development-free. Both notes are
illustrative main fixtures with no full authored text. No material was created, changed or
published in Inside Content or Platform data. Prices, payment, cadence and learning outcomes are
not fabricated.

The proof covers visitor/member presentations, standalone opening, explicit 0/1/N membership,
ordered next/end states, related links, search results/empty search and unknown illustrative note.
It does not prove real auth/entitlements, playback, payment, authoring, persistence, errors/loading,
archive/unpublication/concurrent membership changes, pagination, browser refresh on production
routes or production return-path security. Those need real adapters and tests in #295.

Production visual verification remains a separate integration gate; this proof's accepted direction
and delegated local adjustments do not approve merge/deploy. The proof branch/PR preserves source
and evidence; do not merge throwaway workshop code just to consume it.
