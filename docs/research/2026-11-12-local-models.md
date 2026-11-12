# Local open-weight models on one consumer machine, 2026-11-12

Scope: input for the second step of the Telegram section «ИИ-модели»: a separate part with the best
models a person can run on their own computer. The owner decided on 2026-11-12 to ship the cloud
part first; this note is research input, not an accepted decision.

Evidence notes:

- Facts were read on 2026-11-12; dates are publication or release dates.
- "Arena" is the Arena agent leaderboard published 2026-11-11 (59 models, CC BY 4.0). "AA PI" is the
  Artificial Analysis Progress Index v1 (independent); on that scale the best open model,
  Kimi K3.1 Pro, scores 341. AA shows only the top 12 per size class.
- "est." marks an inference: generation speed ≈ memory bandwidth ÷ bytes of active weights
  (Apple's MLX post of 2025-11-19 says generation is bandwidth-bound).
- Speed figures come mostly from one independent outlet, Hardware Corner: GPU ranking (2025-12-09),
  Qwen3.8-27B tests (2026-08-17), M5 Max with MLX (2026-03-11); plus the llama.cpp Apple Silicon
  discussion #4167 (updated 2026-08-25).

## Main finding

Up to 64 GB, the strongest open model that runs on one consumer machine is Qwen3.8-27B (dense,
Apache 2.0, released 2026-08-14). On a 128 GB Mac the strongest is Qwen3.8-Flash-Next, but only at
2–3-bit quantization. In Arena, the models that fit one machine rank 42–56; every open-weight model
ranked 15–39 has 300B+ parameters.

## Models that run on one machine

| Model | Total / active params | Licence | Released | Arena | AA PI |
|---|---|---|---|---|---|
| Qwen3.8-27B | 27.8B dense | Apache 2.0 | 2026-08-14 | 43 | 303 |
| Nanbeige4.3-33B | 33B dense | Apache 2.0 | HF 2026-10-24 | | 306 |
| K2 Horizon MoVA 36B-A4B (IFM) | 36B / 4B | Apache 2.0 | HF 2026-09-03 | | 281 |
| Muse Glimmer 30B (Meta) | 29.6B dense | Apache 2.0 | 2026-08 (card) | | 267 |
| K2 Horizon 7B | 9.0B dense | Apache 2.0 | HF 2026-09-01 | | 263 |
| Qwen3.6-35B-A3B | 36B / 3B | Apache 2.0 | 2026-04-16 | | 261 |
| Gemma 4 31B / 26B-A4B / 12B | 30.7B; 25.2B / 3.8B; 12B | Apache 2.0 | 2026-04-02 | | 31B: 254 |
| Qwen3.5-9B | 9.7B dense | Apache 2.0 | 2026-03-02 | | |
| gpt-oss-20b / 120b | 20.9B; 117B / 5.1B | Apache 2.0 | HF 2025-08-04 | | 120b: 240 |
| Nemotron 3.5 Bolt 74B-A9B | 74B / 9B | OpenMDW-1.1 | 2026-10-15 | | 269 |
| Qwen3-Coder-Next | 80B / 3B | Apache 2.0 | HF 2026-01-30 | | 227 |
| Nemotron 3.5 Super VL | 120B / 12B | OpenMDW-1.1 | 2026-10-15 | 56 | 284 |
| Qwen3.5-122B-A10B | 125B / 10B | Apache 2.0 | 2026-02-24 | | 261 |
| Qwen3.8-Flash-Next | 125B / 6B, plus 51B n-gram embeddings | qwen-community-1.0 | HF 2026-08-24 | 42 | 320 |
| Mistral Medium 3.5 | 128B dense | Modified MIT | HF 2026-03-31 | 54 | 257 |

qwen-community-1.0 requires attribution above 100M monthly users and a separate licence for selling
model access as a service.

## By hardware tier

File sizes are GGUF files on Hugging Face, or Ollama tags where marked; the context window needs
1–4 GB more. macOS lets the GPU use about 70–75% of unified memory by default (undocumented;
`sysctl iogpu.wired_limit_mb` raises it), so a 16 GB Mac has about 11 GB for the model and a 32 GB
Mac about 22–24 GB.

| Tier | Models and quantization (file size, GB) | Speed |
|---|---|---|
| Mac 16 GB / GPU 12 GB | Gemma 4 12B Q4_K_M 7.1 (Ollama 7.7), Q6_K 9.8; K2 Horizon 7B Q8_0 9.6; Qwen3.5-9B Q6_K 7.5 | Qwen3 14B Q4, 16K context: RTX 3060 23, 4070 33, 5070 41 tok/s; base M4 with a 7 GB file ≈ 12 tok/s (est.) |
| GPU 16 GB | gpt-oss-20b MXFP4 12.1 (Ollama 14); Gemma 4 26B-A4B UD-Q3_K_XL 12.9; Qwen3.8-27B UD-Q3_K_XL 13.1, short context only; Gemma 4 12B Q8_0 13.1 | Qwen3 14B Q4: 5060 Ti 33, 4070 Ti Super 47, 5080 64 tok/s; gpt-oss-20b on a 5080: 140 tok/s |
| Mac 32 GB / GPU 24 GB | Qwen3.8-27B UD-Q4_K_XL 17.7 (Ollama 18); Muse Glimmer 30B UD-Q4_K_XL 15.9; Gemma 4 26B-A4B UD-Q4_K_XL 17.0; Nanbeige4.3-33B Q4_K_M 20.8, tight on a Mac; Qwen3.6-35B-A3B and K2 MoVA 36B 21.7–22.4, GPU only | Qwen3.8-27B Q4: 3090 40, 4090 46 tok/s at 4K context, 34 and 38 at 64K; M5 Pro ≈ 15 tok/s (est.); Qwen3.5-35B-A3B on a Mac 112 tok/s (Ollama blog 2026-03-30) |
| GPU 32 GB (RTX 5090) | Qwen3.8-27B Q4 with long context or Q8_0 29.0 with short; Nemotron 3.5 Bolt NVIDIA 2-bit 22.0; Nanbeige4.3-33B Q5_K_M 25.1 | Qwen3.8-27B Q4: 75 tok/s at 4K, 29 at 32K, 26 at 64K; gpt-oss-20b 249 tok/s |
| Mac 64 GB (≈ 48 GB for the model) | Qwen3.8-27B Q8_0 29.0; Nanbeige4.3-33B Q8_0 35.2; Qwen3-Coder-Next UD-Q3_K_XL 36.3; Nemotron 3.5 Bolt UD-Q3_K_XL 39.0 | 7B Q4 file: M4 Pro ≈ 50, M5 Pro ≈ 67, M4 Max ≈ 83 tok/s; Qwen3.8-27B Q8 ≈ 10–20 tok/s (est.) |
| Mac 128 GB (≈ 96 GB for the model) | Qwen3.8-Flash-Next UD-Q3_K_XL 89.5, UD-Q2_K_XL 79.6 (Ollama's smallest tag 105); Nemotron 3.5 Super VL UD-Q4_K_XL 86.9 (Ollama 80); Qwen3.5-122B-A10B Q4_K_M 76.5; gpt-oss-120b MXFP4 63.4; Mistral Medium 3.5 Q4_K_M 74.9, slow | M5 Max at 4K → 32K context: Qwen3.5-122B 66 → 55, gpt-oss-120b 88 → 65, Qwen3-Coder-Next 8-bit 79 tok/s |

Mixture-of-experts models run 2–4 times faster than dense models of the same file size. On GPUs,
speed drops 2–3 times at 32–64K context.

## Popular open models too big for one machine

Kimi K3.1 Pro (2.8T / 104B, custom licence, Arena 15); MiMo-V2.6-Pro (1T / 42B, MIT, 19);
DeepSeek-V4.1-Flash-1017 (552B / 16B plus 196B Engram memory, MIT, 22, smallest GGUF 335 GB);
GLM-5.3 (753B / 40B, 27); Hy4 preview (780B, Apache 2.0, 30); MiMo-V2.6-Flash (309B / 15B, 33);
MiniMax-M3.1-Flash (428B / 23B, 38, 2-bit file 144 GB); GLM-5.3-Flash (320B / 18B, 39, 2-bit
file 109 GB); Mistral Large 4 (1T / 52B); Beam 1.0 (501B / 23B); Inkling-Small (276B / 12B, 58,
2-bit file 88 GB).

Where the line falls: a 24 GB machine holds about 30B parameters at 4-bit; a 128 GB Mac holds about
120B at 4-bit, or 180–280B at 2–3-bit.

## How people run them

- Runners: Ollama v0.40.16 (2026-11-09; MLX on Apple Silicon since 0.19; OpenAI- and
  Anthropic-compatible endpoints on port 11434); LM Studio 0.4.28 (2026-10-31; GGUF and MLX;
  Anthropic `/v1/messages` since 0.4.1; port 1234); llama.cpp v0.9.0 (2026-11-04; default port now
  9931, changed on 2026-10-09); mlx-lm 0.32.2 (2026-10-16); vLLM 0.33.0; Jan 0.8.8.
- Agents: Ollama (`ollama launch claude`, models with 64k+ context) and LM Studio (about 25k+
  context) document Claude Code with local models, but Anthropic "doesn't support routing Claude
  Code to non-Claude models through any gateway". Codex CLI works with `--oss`. OpenCode, Cline,
  Kilo Code, Qwen Code, Goose and Zed support local models.
- Pitfalls: Ollama's default 2k context silently cuts long requests (Aider docs); Zed sends 4096 by
  default. Roo Code shut down on 2026-05-15; the Continue repository is read-only.

## Sources for a daily check

| Source | Use | Terms |
|---|---|---|
| Hugging Face `/api/models` | `filter=gguf` or `filter=mlx` (`library=gguf` is ignored), `num_parameters`, `sort=trendingScore`, `expand[]=gguf,safetensors`, `author=` unsloth, mlx-community, lmstudio-community, ggml-org | 500 requests per 5 minutes anonymously |
| `lmarena-ai/leaderboard-dataset` | ranks with a `license` column | CC BY 4.0, best fit for republishing |
| Artificial Analysis API | quality index | key; free tier 100 requests a day, attribution, internal use |
| Ollama library | none | no API; terms (August 2026) forbid automated access without permission |
| LM Studio | use the `lmstudio-community` organisation on Hugging Face | no JSON catalogue |
| OpenRouter | none | terms forbid scraping and reuse |

## Gaps

1. Arena and AA test full-precision API versions; nobody independently measured quality at Q2–Q4.
2. Arena covers only four models that fit one machine; AA hides Gemma 4 26B and 12B, Qwen3.5-9B and
   gpt-oss-20b.
3. Vendor claims and independent results diverge: Qwen's card claims SWE-bench Pro 61.7 for
   Qwen3.8-27B against 53.4 for Opus 4.6 Max, while Arena puts Qwen3.8-27B at rank 43, below every
   Claude model.
4. The 16, 32 and 64 GB Mac speeds are estimates.
5. Licences disagree in places: Arena lists GLM-5.3 as MIT, its Hugging Face page names a custom
   "glm-5.3" licence. Some dates are Hugging Face repository creation dates, which can precede the
   release (Qwen3.8-27B: repository 2026-08-05, release 2026-08-14).
6. Not checked: Ollama and LM Studio support for the K2 Horizon MoVA architecture; Nanbeige4.3 is
   missing from the Ollama library.
