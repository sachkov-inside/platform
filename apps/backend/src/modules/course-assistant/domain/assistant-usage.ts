import type { ModelPrices } from "../ports/review-model.js";

/**
 * Стоимость одного вызова модели в миллиардных долях доллара по таблице цен за миллион токенов.
 * Кэшированный вход считается по цене кэша, запись в кэш — по цене обычного входа.
 */
export function costNanoUsd(
  usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
  },
  prices: ModelPrices,
): bigint {
  const uncachedInput = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens,
  );
  // Цена за миллион токенов в долларах = цена за токен в тысячах миллиардных долей.
  const nano =
    (uncachedInput * prices.inputPerMillion +
      usage.cachedInputTokens * prices.cachedInputPerMillion +
      usage.outputTokens * prices.outputPerMillion) *
    1_000;
  return BigInt(Math.round(nano));
}
