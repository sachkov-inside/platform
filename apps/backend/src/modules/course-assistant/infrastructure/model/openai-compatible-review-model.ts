import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  ModelPrices,
  ReviewLimits,
  ReviewModel,
} from "../../ports/review-model.js";

export interface ReviewModelSettings {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly prices?: ModelPrices | undefined;
}

/** Модель проверки у любого OpenAI-совместимого поставщика; выбор — только настройкой. */
export function openAiCompatibleReviewModel(
  settings: ReviewModelSettings,
  limits: ReviewLimits,
): ReviewModel {
  const provider = createOpenAICompatible({
    name: settings.provider,
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    // Без этого поставщик не присылает токены потока, и Assistant Usage осталась бы пустой.
    includeUsage: true,
  });
  return {
    languageModel: provider.chatModel(settings.modelId),
    provider: settings.provider,
    modelId: settings.modelId,
    prices: settings.prices,
    limits,
  };
}
