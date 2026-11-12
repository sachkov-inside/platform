# AI model subscriptions, limits and prices, 2026-11-12

Scope: facts for the planned Telegram section «ИИ-модели» (see the
[Telegram glossary](../../apps/telegram/GLOSSARY.md)): which paid Подписки сервисов include which
ИИ-модели, what each costs, how much work a subscription buys, and which machine-readable sources
a daily agent can check. Vendors: Anthropic, OpenAI, Google, xAI, Moonshot (Kimi), Z.ai (GLM),
DeepSeek, Alibaba (Qwen), MiniMax.

Status: research input, not an accepted decision. The owner chose on 2026-11-12 to show a
subscription's value as approximate tasks per week with API-price dollars under it, and to show the
vendor's own wording where no independent measurement exists; the screens are still to be
prototyped.

Evidence notes:

- Facts were read on 2026-11-12 unless another date is given.
- "Independent" marks a source other than the vendor; "anecdote" marks one user's measurement.
- "At API prices" means what the same traffic would cost through the vendor's API.
- API prices are USD per 1M tokens: input / cache read / output.
- help.openai.com, openai.com/api/pricing and x.ai/pricing returned 403 to the fetch tool.
  OpenAI Pro multipliers, Kimi prices in USD and GLM Pro and Max prices come only from secondary
  sources.
- The owner's knowledge base note R-016 (checked 2026-09-28) is partly outdated: qwen3-coder left
  the Alibaba Coding Plan and GPT-6 Sol is no longer a recommended model.

## Anthropic

| Plan | USD/month | Models | Official limit | Independent estimate |
|---|---|---|---|---|
| Free | 0 | Sonnet, Haiku; no Claude Code | 5-hour window and week, no number | none |
| Pro | 20 (17 yearly) | Opus 5.5, Sonnet, Haiku; Fable 5.2 as a promotion until 16.11, then for extra credits | 5-hour window and week, no number | Wokey: ≈$154/week at API prices, 63.6M tokens (17.4M without cache), ≈$12 per window; 296 accounts, 2–9.11 |
| Max (formerly Max 5x) | 100 | + Fable 5.2 | "5x Pro" per 5 hours and per week; separate weekly Fable limit | anecdotes: $420/week (Danube Labs, 21.09–4.10), ≥$1,217/week (FinOps LLM, Aug–Sep) |
| Ultra (formerly Max 20x, since 30.10) | 200 | as Max | no 5-hour window for verified accounts; "10 times the Pro plan's usage every week"; separate Fable limit | Wokey: ≈$1,623/week (≈10.5x Pro), 2.52B tokens; 21 accounts, 2–9.11 |

Agent in every paid plan: Claude Code.
API: Fable 5.2 8 / 0.20 / 40; Opus 5.5 4 / 0.20 / 20; Sonnet 5.5 2 / 0.10 / 10;
Haiku 5.5 0.10 / 0.01 / 0.50 (prompt up to 100K). Batch is 50% cheaper.

Sources: claude.com/pricing; support.claude.com/en/articles/17728952 (Ultra), 11049741 (Max),
15424964 (Fable); platform.claude.com/docs/en/about-claude/pricing. Independent:
wokey.ai/claude-usage-limits (9.11), danubelabs.net (4.10), finopsllm.com (10.10).

## OpenAI

| Plan | USD/month | Models | Official limit in Codex | Independent estimate |
|---|---|---|---|---|
| Free / Go | 0 / 8 | GPT-6 Luna | "quick / lightweight tasks", no number | none |
| Plus | 20 | GPT-6 Astra, 6.1 Sol, 6.1 Terra, 6 Sol, 6 Luna | local messages per 5 hours: Astra 5–45, 6.1 Sol 15–160, 6.1 Terra 35–285, Luna 350–3,000; cloud tasks share the quota; "Weekly limits may also apply", no number | Wokey: $46/week, 6 accounts, 2–9.11; FinOps LLM: median $67/week, Aug–Oct, sample size not given |
| Pro | 100 / 200 / 500 | + GPT-5.6 Sol Pro | "Pro plans currently have no five-hour limit"; weekly limit not published; 5x/20x/25x Plus and the 29.10 doubling appear only in secondary sources | Pro 200: Wokey $581/week (7 accounts, 26.10–2.11, spans a limit change); anecdote $1,271/week (emsi.me, 3.11) |

Codex runs on the web, in the CLI, in IDEs and on iOS. Business costs $25/month ($20 yearly) with
Plus limits. A secondary source says ChatGPT and Codex get a shared quota in December.
API (prompt up to 272K): gpt-6-astra 10 / 1 / 50; gpt-6.1-sol 2 / 0.10 / 10;
gpt-6.1-terra 1 / 0.05 / 5; gpt-6-luna 0.10 / 0.01 / 0.50. Above 272K input costs 2x and output
1.5x.

Sources: learn.chatgpt.com/docs/pricing, developers.openai.com/api/docs/pricing. Independent:
wokey.ai/codex-usage-limits, finopsllm.com.

## Google

| Plan | USD/month | Models | Agents | Official limit |
|---|---|---|---|---|
| AI Plus | 4.99 | Flash | none | "2x higher usage access than Free" |
| AI Pro | 19.99 | Gemini 4 Argon, 3.1 Pro, Flash | Antigravity ("Entry rate limits"), Jules 100 tasks per 24 hours | "4x higher than Free"; 5-hour window up to a weekly limit, no numbers |
| AI Ultra 5x / 20x | 99.99 / 199.99 | + Gemini 4 Carbon | Antigravity ("Higher" / "Highest rate limits"), Jules 300 per 24 hours | "5x / 20x higher usage limits vs. AI Pro" |
| Code Assist Standard / Enterprise | 22.80 / 54 | Gemini | Gemini CLI | 1,500 / 2,000 requests per day; no new sales since 9.10 |

No independent measurements. Forum anecdotes from March–April predate the quota change of 19.05.
Since 18.06 free and Google One users run Antigravity CLI in place of Gemini CLI.
API: gemini-4-carbon and gemini-4-argon 2 / 0.10 / 10 until 30.11, doubled from 1.12, no free
tier; gemini-3.8-flash 0.75 / 0.075 / 3.75, doubled from 1.01.2027.

Sources: gemini.google/us/subscriptions, jules.google/docs/usage-limits,
antigravity.google/blog/changes-to-antigravity-plans (19.05), aistudio.google.com/docs/pricing.

## xAI

Since 12.10 new customers buy The X Subscription; existing SuperGrok plans stay with their owners.

| Plan | USD/month | Models and agents | Official limit |
|---|---|---|---|
| Plus | 8 | Grok 4.7, 4.6, 4.5; Grok Build CLI, Cursor Agent on Grok models | "Base", weekly pool shared by Grok and Cursor |
| Premium / Super / Ultra | 30 / 100 / 200 | + cloud agents, Bugbot; other vendors' models in Cursor are paid separately | 4x / 15x / 50x Plus |

No independent measurements; one unverified post on X.
API: grok-4.7 2 / 0.50 / 6 up to 200K, doubled above; grok-build-0.1 1 / 0.20 / 2.

Sources: docs.x.ai/x-subscription/pricing, x.ai/news/x-subscription (12.10),
docs.x.ai/developers/pricing.

## Chinese vendors

| Plan | USD/month | Models | Official limit | Independent estimate |
|---|---|---|---|---|
| Kimi Plus / Pro / Max / Ultra | officially only ¥99 / 199 / 699 / 1,399 (19.10); $19 / 39 / 99 / 199 per price trackers | K3.1 Pro, K3 | 5-hour window, no weekly limit, monthly pool shared with chat; no numbers | Wokey: Max per window ≈1.1M input or 111K output tokens of K3.1 Pro, ≈$48/month at API prices (1 account); Pro 0.27x Max (11 accounts, 2–9.11) |
| GLM Coding Plan Lite / Pro / Max | 18 / 80 / 168 (officially only "from $18") | GLM-5.3, 5.3-Flash | credits per 5 hours / week: 2,000 / 10,000; 12,000 / 60,000; 28,000 / 140,000; credits = (input×6.9 + cache×1.7 + output×24) / 10,000, half off peak; Z.ai estimates Lite at 48–97M GLM-5.3 tokens per week at 95% cache | no measurements; Z.ai's estimate at API prices gives Lite ≈$65–133/month (Morph, 15.10; recomputed with the same result) |
| DeepSeek | no subscription | | | |
| Alibaba Coding Plan Pro | 50 | qwen3.7-plus, qwen3.6-plus, kimi-k2.5, glm-5, MiniMax-M2.5 | 6,000 requests per 5 hours, 45,000 per week, 90,000 per month; "simple tasks typically use 5–10 calls… complex 10–30 or more" | no measurements |
| Alibaba Token Plan, 4 tiers | 6 / 10 / 18 / 43 | qwen4-max-preview, qwen3.8-max, deepseek-v4.1-flash, glm-5.3 and others | 20K / 45K / 80K / 200K credits per month | none |
| MiniMax M Plan Go / Explore / Build | 22 / 55 / 132 | Go has only M3.1 Flash | 5-hour window and week, multipliers 1x / 3x / 7.5x only | none |

Agents: Kimi has its own Kimi Code CLI and guides for Claude Code, OpenCode and Codex. GLM runs in
ZCode, Claude Code, Codex, OpenCode and Cline ("20+" tools). Alibaba runs in Claude Code, Qwen Code,
OpenCode, Cursor and Cline. MiniMax ships MiniMax Code and a key for Claude Code and Codex.

GLM, Alibaba, MiniMax and Kimi allow their plans only for interactive work in supported tools.
Z.ai threatens a ban after three violations.

API: Kimi K3.1 Pro 2 / 0.20 / 10; GLM-5.3 1.40 / 0.26 / 4.40; DeepSeek V4.1 Flash
(`deepseek-flash`) 0.30 / 0.006 / 1.20 at peak hours, 50% cheaper otherwise; V4 Pro
1.32 / 0.044 / 3.96; qwen3.8-max 2 / 6 (input / output); MiniMax M3 0.30 / 0.06 / 1.20.

Sources: kimi.com/en/help/membership/membership-pricing, docs.z.ai/devpack/overview,
api-docs.deepseek.com/quick_start/pricing, alibabacloud.com/help/en/model-studio/coding-plan (4.11)
and token-plan-personal-overview (11.11), platform.minimax.io/docs/guides/pricing-token-plan.
Independent: wokey.ai/kimi-code-limits, morphllm.com/coding-plan (15.10),
jia.je/kb/en/software/coding_plan.html (11.11).

## OpenCode Go (added later on 2026-11-12)

The first pass missed this plan; the owner pointed to it. OpenCode sells one subscription that
covers many open-weight models, each with its own monthly allowance in dollars.

| Plan | USD/month | Per-model monthly allowance, Go / Go Plus |
|---|---|---|
| Go / Go Plus | 10 / 40 | DeepSeek V4.1 Flash $100 / $200; MiniMax M3 $60 / $180; Gemini 4 Argon $30 / $120 (50% discount through 2026-11-30); GLM-5.3 $15 / $120; Kimi K3.1 Pro $15 / $60; Qwen3.8 Max $15 / $60; Grok 4.7 $15 / $60 |

Go and Go Plus include the same 36 models. "Each model has the following usage limits: 5-hour, 20% of
the monthly limit; weekly, 50%; and monthly, 100%." Teams is listed without a price. No country list
or payment methods for the plan itself; inference regions default to Europe and the United States.
Third-party guides from October report overall caps of $12 per 5 hours, $30 per week and $60 per
month, which the current docs page does not show.

Converted with the Arena task cost (inference): Go gives about 160 DeepSeek V4.1 Flash tasks a week
($100 × 12/52 ÷ $0.144), 39 MiniMax M3, 9 Gemini 4 Argon, 3 each of GLM-5.3, Kimi K3.1 Pro and
Qwen3.8 Max, 1 Grok 4.7.

Sources: opencode.ai/docs/go and opencode.ai/go (read 2026-11-12).

DeepSeek Harness (`dsh`) is DeepSeek's own open-source coding agent, MIT licence, released
2026-08-13 as a developer preview with breaking changes expected; it also works with other
providers. Sources are third-party (composio.dev, thenewstack.io, docs.kanaries.net).

## A "typical task"

No shared definition exists. Usable anchors:

- **Anthropic.** Claude Code paid through the API costs companies ≈$13 per developer per active day
  and $150–250 per month; 90% of users stay under $30 per day (code.claude.com/docs/en/costs,
  undated).
- **OpenAI.** "A typical GPT-5.6 Sol task may use 2-15 credits". The credit table equals API prices
  divided by $0.04, so a task costs ≈$0.08–0.60. OpenAI does not publish the credit price; $0.04 is
  an inference.
- **Arena agent leaderboard** (independent): Hugging Face dataset `lmarena-ai/leaderboard-dataset`,
  config `agent`, CC BY 4.0, last published 11.11. Field `cost_per_task_p50`: Opus 5.5 $5.47,
  GPT-6.1 Sol $1.06, Gemini 4 Carbon $1.46. Based on more than 1.7M real sessions, ≈26% of them
  coding. Arena does not say how it counts cache.
- **Artificial Analysis Coding Agent Index v2.0** (independent): 290 hard tasks, 3 runs each;
  2–27M tokens per task, 87–98% from cache, $0.16–13 per task. Cache is counted separately, but
  free data is for internal use only.
- **Requesty** (gateway telemetry, May 2026): 84K input tokens per call on average, 86% from cache;
  an active user spends $23 per month at the median and $108 on average.

Candidate formula (inference, not validated): tasks per week = a plan's weekly value at API prices /
the model's median task cost on Arena. Claude Pro: $154 / $5.47 ≈ 28 Opus 5.5 tasks per week.
Codex Plus: $46 / $1.06 ≈ 43 GPT-6.1 Sol tasks per week. Wokey and Arena treat cache differently,
so the result is an order of magnitude only.

## Machine-readable sources

| Source | Gives | Access | Terms | Updates |
|---|---|---|---|---|
| OpenRouter `/api/v1/models` | prices of 468 models, cache included | JSON, opened without a key | site terms (31.08) forbid to "scrape or copy any information" | 120 s cache |
| LiteLLM `model_prices_and_context_window.json` | 5,920 entries with cache prices | JSON file on GitHub | MIT | daily commits |
| models.dev `/api.json` | 235 providers, coding plans included | JSON | MIT | daily |
| Vendors themselves | none of the nine publishes a JSON price list; xAI has `/v1/language-models` behind a key (not checked) | HTML | | |
| Artificial Analysis Data API | quality index, prices | REST, key, 100 requests per day | free tier "Internal use only with attribution"; a public bot needs the paid Commercial tier | frequent |
| Arena (LMArena renamed on 28.01.2026) | text, webdev, agent with cost per task | Hugging Face dataset | CC BY 4.0 | last published 11.11 |
| Epoch AI Benchmarking Hub | benchmark results | CSV, Python client | CC BY 4.0 | updated 12.11 |
| Terminal-Bench 4.1 | accuracy, cost, tokens | JSON inside the page | data licence not stated | weekly |
| Wokey | plan measurements for Claude, Codex, Kimi | HTML | commercial gateway | every Monday |

SWE-bench has not updated since February 2026, Aider since October 2025. Scale SEAL is
"All rights reserved".

## Gaps

1. Anthropic, Google, xAI, Kimi and MiniMax publish no absolute limits. Tokens per plan for them
   come only from independent measurements.
2. Almost all measurements come from Wokey, a paid gateway that sells API access next to these
   subscriptions. Samples range from 1 to 296 accounts over one week. Google, xAI, MiniMax and
   Alibaba have no measurements.
3. Limits change often: Anthropic on 14.09, 22.09 and 30.10; OpenAI on 29.10 with a merge promised
   for December; xAI on 12.10; MiniMax around 1.10. Most measurements predate at least one change.
4. Promotions expire: Fable on Pro until 16.11; GPT-5.6 Sol promotion until 21.11 on the Codex page
   and until 30.11 on the API page; Gemini 4 price doubles on 1.12.
5. Tokens are not comparable across vendors: tokenizers differ and the cache share changes the cost
   many times over. Dollars at API prices with a fixed cache share compare more fairly.
