// PROTOTYPE, throwaway (#1984). The provider is a setting: one OpenAI-compatible endpoint per name.
// Keys come from ~/.config/inside/assistant-prototype.env (outside the repository).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

for (const line of readFileSync(`${homedir()}/.config/inside/assistant-prototype.env`, "utf8").split("\n")) {
  const [key, ...value] = line.split("=");
  if (key && value.length && !process.env[key]) process.env[key] = value.join("=");
}

export const providers = {
  aitunnel: createOpenAICompatible({
    name: "aitunnel",
    baseURL: "https://api.aitunnel.ru/v1",
    apiKey: process.env.AITUNNEL_API_KEY,
    includeUsage: true,
  }),
  deepseek: createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY,
    includeUsage: true,
  }),
};

// The same model, DeepSeek V4.1 Flash, under each provider's own name.
export const chatModel = {
  aitunnel: "deepseek-v4.1-flash",
  deepseek: "deepseek-flash",
} as const;

export type ProviderName = keyof typeof providers;
export const model = (name: ProviderName) => providers[name].chatModel(chatModel[name]);

// Prices, ₽ per 1M tokens: AITunnel catalog of 07.11.2026. DeepSeek bills in USD; cost is taken from the balance.
export const aitunnelPrice: Record<string, { input: number; output: number }> = {
  "deepseek-v4.1-flash": { input: 9, output: 100 },
};

export async function balances() {
  const [a, d] = await Promise.all([
    fetch("https://api.aitunnel.ru/v1/aitunnel/balance", { headers: { authorization: `Bearer ${process.env.AITUNNEL_API_KEY}` } }).then((r) => r.json()),
    fetch("https://api.deepseek.com/user/balance", { headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` } }).then((r) => r.json()),
  ]);
  return {
    aitunnelRub: a.balance as number,
    deepseekUsd: Number(d.balance_infos.find((b: { currency: string }) => b.currency === "USD")?.total_balance),
  };
}
