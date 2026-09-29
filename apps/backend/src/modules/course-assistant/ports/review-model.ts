import type { LanguageModel } from "ai";

/** Цены модели в долларах США за миллион токенов; версия таблицы пишется в Assistant Usage. */
export interface ModelPrices {
  readonly version: string;
  readonly inputPerMillion: number;
  readonly cachedInputPerMillion: number;
  readonly outputPerMillion: number;
}

export interface ReviewLimits {
  /** Сколько вызовов модели может занять одна проверка. */
  readonly maxSteps: number;
  /** Сколько токенов входа и выхода вместе может занять одна проверка. */
  readonly maxTokens: number;
  readonly maxOutputTokens: number;
}

/**
 * Модель проверки за портом модуля (#788): `LanguageModel` Vercel AI SDK. Настройка выбирает
 * OpenAI-совместимого поставщика и модель; тесты подставляют детерминированную модель.
 */
export interface ReviewModel {
  readonly languageModel: LanguageModel;
  readonly provider: string;
  readonly modelId: string;
  readonly prices: ModelPrices | undefined;
  readonly limits: ReviewLimits;
}
