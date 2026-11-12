---
name: ai-models-refresh
description: Refresh the «ИИ-модели» Справочник, the bot's list of AI models: research current prices, plans, limits and ranks, show the owner a draft with a change list, and publish it to production after approval. Use when the owner asks to update or check the models list, prices or subscriptions.
---

# Refresh the «ИИ-модели» Справочник

The Справочник is `apps/telegram/content/ai-models-reference.json` in format
`inside.ai-models-reference.v1`: read the [contract](../../../apps/telegram/docs/integrations/ai-models-reference-v1.md)
and the section terms in the [Telegram glossary](../../../apps/telegram/GLOSSARY.md) first. Earlier
research with its sources: [subscriptions note](../../../docs/research/2026-11-12-ai-model-subscriptions.md).

The file has two owners:

- **Facts**, everything outside `author`: you keep them current from sources.
- **`author`**: the owner's opinion (badges, «Мой выбор», «Лучше взять», ban risk, advice). It
  changes only on the owner's words in this session.

## Steps

1. **Workspace.** Create a branch `chore/ai-models-reference-<YYYY-MM-DD>` and its worktree from
   `origin/main` under [delivery](../../../docs/agents/delivery.md).
2. **Research.** Re-check every fact of every model, service and plan against a source read today,
   and keep a source list (URL and date) for the change list:
   - Arena rank and task cost: Hugging Face dataset `lmarena-ai/leaderboard-dataset`, config
     `agent`, split `latest`; per model, the row with the highest score.
   - API prices per 1M tokens and announced changes: the vendor's pricing page. LiteLLM
     `model_prices_and_context_window.json` and `models.dev/api.json` serve only as a cross-check.
   - Plans, prices and limit wording: the vendor's pages. OpenCode Go per-model dollar allowances:
     `opencode.ai/docs/go`.
   - Subscription estimate: an independent measurement of at least 5 accounts (such as Wokey),
     converted to dollars per month (weekly × 52 / 12); else the vendor's dollar limit; else the
     vendor's own wording.
   - Russia flags: official supported-country and payment pages only; `unknown` when unclear. The
     Справочник speaks only of «из России» and «карта РФ», never of ways around blocks.
   - Candidates: new models in the Arena agent top 30 from the file's families or major vendors,
     and successors of listed models. These become proposals, not edits.

   Done when every fact in the file is confirmed or replaced, each with a source.
3. **Draft.** Write the new facts into the file: `checkedOn` is today, codes stay stable, texts stay
   within the contract's limits and use commas or periods in place of `|` and long dashes. Models
   are added or removed only after the owner's yes.
4. **Validate.** From `apps/telegram`, run
   `pnpm vitest run test/unit/ai-models-reference-current.test.ts` (the import's whole-file check,
   1 024-byte answers included) and `pnpm ai-models:widget:fit content/ai-models-reference.json`
   (every screen within 560 px at 320 and 390 px). Edit the file until both pass.
5. **Change list.** Send the owner one message in plain Russian (the `plain-writing` skill, when
   present):
   - each changed fact with a short source, such as «Gemini 4 Carbon: API вдвое дороже с 1.12, страница цен Google»;
   - questions with a recommendation for every proposal: models to add or drop, a new Лучший агент,
     and author items the new facts contradict, such as «Дорого» on a model that became cheap.

   Apply the answers. For an added model, propose its Сводка модели and author part for approval.
6. **Publish on the owner's «публикуй».** That word is the owner-gate permission for both the
   merge and the production import.
   - Commit `docs(telegram): Справочник «ИИ-моделей» на <date>`, open a PR whose body carries the
     change list, and finish it through [ship](../../../docs/agents/ship.md) and the merge queue.
   - Import the merged file under the [import runbook](../../../apps/telegram/docs/operations/ai-models-reference.md):
     copy it to `/var/lib/inside/ai-models-reference-<YYYYMMDD>-<sha12>/ai-models-reference.json`
     on `inside-production`, run `--preview`, then `--apply`.

   Done when the import reports `imported` or `unchanged` with the new `checkedOn`.
7. **Report.** Give the owner the PR, the import report (`revision`, `models`, `largestAnswer`) and
   every fact you could not confirm.
