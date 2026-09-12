import { parseTbankConfig, type TbankConfig } from "../../src/config/tbank-config.js";

/**
 * Синтетический терминал тестов собирается тем же путём, что боевой: из JSON терминала, поэтому
 * его контур — настоящие адреса банка, а не отдельная тестовая настройка.
 */
export function syntheticTbankConfig(terminal: Readonly<Record<string, unknown>>): TbankConfig {
  const config = parseTbankConfig(JSON.stringify(terminal));
  if (!config) throw new Error("Synthetic terminal configuration is incomplete");
  return config;
}
