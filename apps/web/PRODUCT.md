# Sachkov Inside Platform web

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Публичный посетитель находит и читает бесплатные материалы и понимает состав Membership.
- Участник Membership находит и читает доступные материалы, управляет минимальным reading state и
  приватным Account.
- Единственный автор первой версии — Кирилл. Он выбирает тему из доступного каталога, создаёт и
  изменяет current Material, проверяет Preview сохранённого `contentVersion` и явно выбирает
  publication state в full-state Save.
- Owner agent выполняет тот же bounded authoring workflow через MCP и общие application rules, но
  не публикует автономно.

## Product Purpose

Platform — канонический дом полноценных материалов Sachkov Inside. Она объединяет discovery,
reading и authoring так, чтобы current Material, опубликованные projections и Preview не
расходились между разными инструментами.

## Positioning

Материал хранит инженерную практику вместе с контекстом решений и связанными artifacts. Browser UI
и owner agent используют один application contract, stable Material identity, `contentVersion` и conflict semantics;
интерфейс не создаёт параллельную content authority.

## Operating Context

- Публичные и member surfaces ориентированы на чтение и поиск; author surfaces — на выполнение
  точной editorial задачи.
- Полные актуальные материалы создаются вручную в целевой структуре Platform. Telegram остаётся
  местом community и анонсов, а не источником для import/migration.
- Storybook является исполнимой design/review-системой. Production-owned UI modules имеют stories;
  fixtures и workshop composition не входят в production dependency graph.

## Capabilities and Constraints

- Product terminology следует repository `CONTEXT.md`: Material, MaterialBody, publication state и
  `contentVersion` не заменяются размытыми словами «post» или historical revision.
- Preview всегда читает current saved Material, показывает его `contentVersion` и не меняет
  publication state.
- Authoring полностью доступен на narrow mobile. Editor показывает dirty, submitting, saved,
  authorization, conflict и infrastructure failure states без копирования backend business rules.
- Тема Material выбирается из доступного каталога, а не вводится произвольной строкой.
- Выбор `published` остаётся явным owner action; autonomous publish, collaborative realtime
  editing, multi-author review и content import не входят в v1.
- UI contracts скрывают backend transport DTO и остаются малыми, serializable и пригодными для
  fixture и production adapters.

## Brand Commitments

- Product name: Sachkov Inside.
- Russian is the primary interface language; established domain and engineering terms stay exact.
- Voice is direct, calm and operational: controls name the user action, failures explain recovery,
  and technical state is shown only when it helps the author act safely.

## Evidence on Hand

- Canonical scope: `docs/product/platform-mvp-brief.md`.
- Approved structural UX: `docs/product/platform-v1-ux-brief.md`.
- Owner-taste constraints and accepted UI-laboratory direction:
  `docs/product/platform-v1-visual-brief.md`.
- Application vocabulary: `CONTEXT.md`.
- Storybook contains accepted shell, Library and Material reader proofs plus representative
  sanitized content fixtures. No testimonials, customer logos, commercial benchmarks or other
  marketing proof may be invented.

## Product Principles

1. Exact state beats implied freshness: identify the Material and `contentVersion` being edited or previewed.
2. One semantic workflow serves human and agent callers; adapters do not reimplement policy.
3. Reading surfaces recede around content; authoring surfaces expose the controls and recovery
   information needed to work safely.
4. Mobile authoring is a primary capability, not a reduced preview mode.
5. Storybook records reusable design and behavior before production integration.

## Accessibility & Inclusion

Critical journeys support semantic landmarks and headings, keyboard operation, visible focus,
programmatically announced status/errors, screen-reader names, 200% text zoom, narrow viewports
and reduced-motion preferences. Color is never the only state indicator.
