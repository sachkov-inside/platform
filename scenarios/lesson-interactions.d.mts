interface RatingCounts {
  readonly likes: number;
  readonly dislikes: number;
}
interface OptionMistake {
  readonly kind: "options";
  readonly optionIds: readonly string[];
  readonly count: number;
}
export const lessonInteractions: {
  readonly materialId: string;
  readonly exercise: {
    readonly id: string;
    readonly kind: "quiz";
    readonly fingerprint: string;
    readonly question: string;
    readonly options: { readonly embed: string; readonly prompt: string };
  };
  readonly attempt: {
    readonly exerciseId: string;
    readonly fingerprint: string;
    readonly answer: {
      readonly kind: "options";
      readonly optionIds: readonly string[];
    };
    readonly result: "correct";
    readonly firstForVersion: true;
    readonly attemptedAt: string;
  };
  readonly module: {
    readonly ratings: RatingCounts;
    readonly statistics: readonly {
      readonly exerciseId: string;
      readonly kind: "quiz";
      readonly versions: readonly {
        readonly fingerprint: string;
        readonly firstAnsweredAt: string;
        readonly respondents: number;
        readonly firstTryCorrect: number;
        readonly firstTryDontKnow: number;
        readonly mostFrequentMistake: OptionMistake;
      }[];
    }[];
  };
  readonly storybook: {
    readonly ratings: RatingCounts;
    readonly versions: readonly {
      readonly fingerprint: string;
      readonly current: boolean;
      readonly firstAnsweredAt: string;
      readonly respondents: number;
      readonly firstTryCorrectPercent: number;
      readonly firstTryDontKnow: number;
      readonly wrongOption: "embed" | "prompt";
      readonly wrongCount: number;
    }[];
    readonly unanswered: { readonly id: string; readonly question: string };
  };
};
