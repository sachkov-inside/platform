import { MockLanguageModelV4 } from "ai/test";
import type {
  ModelPrices,
  ReviewModel,
} from "../../src/modules/course-assistant/ports/review-model.js";

/** Один вызов модели в сценарии: вызовы инструментов, простой текст или сбой поставщика. */
export type ScriptedStep =
  | {
      readonly toolCalls: readonly {
        readonly toolName: string;
        readonly input: unknown;
      }[];
    }
  | { readonly text: string }
  | { readonly error: Error };

export interface ScriptedUsage {
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
}

export const defaultScriptedUsage: ScriptedUsage = {
  input: 1_200,
  cacheRead: 800,
  output: 150,
};

/**
 * Детерминированная модель проверки: отвечает шагами сценария по порядку и запоминает, что ей
 * передали. Последний шаг повторяется, если вызовов больше, чем шагов.
 */
export function scriptedReviewModel(
  steps: readonly ScriptedStep[],
  options: {
    readonly usage?: ScriptedUsage;
    readonly prices?: ModelPrices;
    readonly maxSteps?: number;
    readonly maxTokens?: number;
  } = {},
): {
  readonly model: ReviewModel;
  readonly calls: MockLanguageModelV4["doGenerateCalls"];
} {
  const usage = options.usage ?? defaultScriptedUsage;
  let index = 0;
  const languageModel = new MockLanguageModelV4({
    provider: "synthetic",
    modelId: "synthetic-reviewer",
    doGenerate: () => {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === undefined) throw new Error("Empty scenario");
      if ("error" in step) return Promise.reject(step.error);
      return Promise.resolve({
        content:
          "text" in step
            ? [{ type: "text" as const, text: step.text }]
            : step.toolCalls.map((call, position) => ({
                type: "tool-call" as const,
                toolCallId: `call-${String(index)}-${String(position)}`,
                toolName: call.toolName,
                input: JSON.stringify(call.input),
              })),
        finishReason: {
          unified: "text" in step ? ("stop" as const) : ("tool-calls" as const),
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input - usage.cacheRead,
            cacheRead: usage.cacheRead,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: usage.output,
            text: usage.output,
            reasoning: undefined,
          },
        },
        warnings: [],
      });
    },
  });
  return {
    model: {
      languageModel,
      provider: "synthetic",
      modelId: "synthetic-reviewer",
      prices: options.prices,
      limits: {
        maxSteps: options.maxSteps ?? 8,
        maxTokens: options.maxTokens ?? 1_000_000,
        maxOutputTokens: 4_000,
      },
    },
    calls: languageModel.doGenerateCalls,
  };
}

/** Итог проверки, который модель отдаёт через `submit_review`. */
export function submitReview(
  statuses: Readonly<
    Record<string, "confirmed" | "violation" | "not_verified">
  >,
  evidencePath = "docs/brief.md",
) {
  return {
    toolName: "submit_review",
    input: {
      summary: "Проверка по всем критериям задания.",
      criteria: Object.entries(statuses).map(([criterionId, status]) => ({
        criterionId,
        status,
        evidence: [{ path: evidencePath, startLine: 1, endLine: 3 }],
        explanation: `Критерий ${criterionId}: вывод по свидетельству.`,
        nextStep:
          status === "confirmed" ? null : "Добавь недостающее свидетельство.",
      })),
    },
  };
}
