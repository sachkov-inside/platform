/** Критерий задания; текст критерия — авторские данные, а не инструкции модели. */
export interface PracticeCriterion {
  readonly id: string;
  readonly requirement: string;
}

/**
 * Зафиксированный контекст задания из #785: определение практики, доверенный протокол проверки и
 * полный урок. Помощник не хранит копию критериев; в проверке сохраняется только contextVersion.
 */
export interface PracticeContext {
  readonly practiceId: string;
  readonly contextVersion: string;
  readonly title: string;
  readonly criteria: readonly PracticeCriterion[];
  /** Доверенный протокол Platform, поставляемый отдельно от данных. */
  readonly reviewProtocol: {
    readonly version: string;
    readonly instructions: readonly string[];
  };
  /** Задание и урок в каноническом JSON #785: недоверенные данные для модели. */
  readonly data: string;
}

export type PracticeContextFailure =
  | { readonly reason: "practice_unavailable" }
  | {
      readonly reason: "context_version_mismatch";
      readonly currentContextVersion: string;
    }
  | { readonly reason: "dependency_unavailable" };

export interface PracticeDescription {
  readonly practiceId: string;
  readonly contextVersion: string;
  readonly title: string;
  readonly criteria: readonly PracticeCriterion[];
}

/** Задание, доступное Account прямо сейчас (ContentAccess решает Materials). */
export interface PracticeContextSource {
  /** Определение задания без урока: для показа беседы и сверки версии. */
  describe(query: {
    readonly accountId: string;
    readonly practiceId: string;
  }): Promise<
    | { readonly ok: true; readonly value: PracticeDescription }
    | ({ readonly ok: false } & PracticeContextFailure)
  >;
  /** Полный контекст ровно той версии, которую ожидает проверка. */
  read(query: {
    readonly accountId: string;
    readonly practiceId: string;
    readonly expectedContextVersion: string;
  }): Promise<
    | { readonly ok: true; readonly value: PracticeContext }
    | ({ readonly ok: false } & PracticeContextFailure)
  >;
}
