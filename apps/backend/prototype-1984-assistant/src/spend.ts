// PROTOTYPE, throwaway (#1984). Ledger of every paid call: .data/spend.jsonl.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const file = new URL("../.data/spend.jsonl", import.meta.url);

export function record(entry: { stage: string; provider: string; model: string; inputTokens?: number; outputTokens?: number; costRub?: number }) {
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function total(stage?: string) {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => !stage || e.stage === stage).reduce((a, e) => a + (e.costRub ?? 0), 0);
}
