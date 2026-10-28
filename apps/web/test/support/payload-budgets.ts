// Production fixture baseline, 28.10.2026, desktop/mobile Chromium, Next 16.4.1:
// 120-Material Flight 927,610 bytes; film scripts up to 1,276,051 bytes.
// Rounded budgets retain approximately 18% headroom. These are uncompressed response bodies,
// observed at the existing rendered-film checkpoint, not transfer sizes or a universal page goal.
const budgets = {
  programmeFlight: 1_100_000,
  courseScripts: 1_500_000,
} as const;

export function assertPayloadBudget(
  name: keyof typeof budgets,
  bytes: number,
): void {
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > budgets[name]) {
    throw new Error(
      `${name}: ${String(bytes)} bytes exceeds or invalidates the ${String(budgets[name])}-byte payload budget`,
    );
  }
}
