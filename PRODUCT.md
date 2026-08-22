# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary reader is a developer who already knows how to program and independently chooses
relevant directions. Public visitors evaluate the real Membership catalog; active and former
members discover and read available Materials. The owner-author creates, revises, validates and
previews one Material revision before a separate publish approval.

## Product Purpose

Platform is the canonical home of full Inside Materials. It helps people discover and read
engineering content while keeping Telegram focused on community, short announcements and the
external Membership lifecycle. Success means that a reader can find one relevant Material and
understand or consume it, while the owner can author the same structured content through an
auditable revision flow.

## Positioning

Inside exposes real engineering practice: the context of decisions and the connected code,
diagrams, documents, media and delivery evidence—not only a finished answer or a prescribed linear
course.

## Operating Context

Readers move between Library search, Topics, Series, Roadmap and Materials. Materials may combine
long-form text, code, tables, callouts, images, files and video. The owner works with immutable
revisions, explicit validation, Preview and a separate owner-controlled publish gate.

## Capabilities and Constraints

- Top-level product navigation is `Главная`, `Библиотека`, `Карта`; Topics and Series are
  contextual.
- Public visitors can read free Materials without an account and can inspect public teasers for
  closed Materials without protected body or resource data leaking into the page.
- Library search uses real populated Topic, Format and Series facets. Values are OR-ed within a
  facet and AND-ed between facets.
- Reading state changes only through explicit user action; there is no forced course progress,
  streak or completion theater.
- Authoring remains usable on narrow mobile. Preview renders an exact revision but does not publish
  or mutate it.
- The application stack is Next.js App Router and React. Prototype data remains in memory and does
  not introduce backend, authentication or persistence work.
- Component-library selection is deliberately deferred until the visual concepts expose concrete
  needs.

## Brand Commitments

The product is named Sachkov Inside Platform and remains recognizably related to the current
Sachkov Inside family. Its voice is calm, direct and technically precise. Visual decisions remain
provisional until rendered owner review and are recorded separately from this product truth.

## Evidence on Hand

- Product and domain context: `CONTEXT.md`, `docs/product/platform-mvp-brief.md` and
  `docs/specifications/platform-v1.md`.
- Owner-approved actors, journeys, states, copy and sanitized F1–F3 fixture corpus:
  `docs/product/platform-v1-ux-brief.md`.
- Owner-calibrated preferences, references, anti-references and H1–H3 hypotheses:
  `docs/product/platform-v1-visual-brief.md`.
- The evidence is product and design input, not testimonials, commercial claims or production
  analytics; future UI must not fabricate those forms of proof.

## Product Principles

1. Real content and observable states outrank decorative chrome.
2. Reading is self-directed discovery, not a compulsory course path.
3. Access is explained coarsely and safely without leaking protected content or provider detail.
4. Authoring and delivery preserve exact revisions, explicit validation and owner-controlled
   publication.
5. Visual and component decisions expand only after responsive evidence and owner review.

## Accessibility & Inclusion

Critical journeys must work keyboard-only with visible focus, semantic landmarks and announced
errors. Narrow viewports, text zoom and reduced motion must preserve content and controls. UI proof
must have no serious or critical automated accessibility findings.
