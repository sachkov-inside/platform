export type LegacyTaskKey = "onboarding" | "requests";
export type LegacyPersonKey = "anna" | "mark" | "olga";

export interface LegacyCriterionFact {
  readonly id: string;
  readonly level: "required" | "additional";
  readonly requirement: string;
  readonly acceptableEvidence: readonly string[];
}

export interface LegacyFeedbackFact {
  readonly comment: string;
  readonly reviewedAt: string | null;
  readonly updatedAt: string;
}

export interface LegacySubmissionFact {
  readonly id: string;
  readonly task: LegacyTaskKey;
  readonly person: LegacyPersonKey;
  readonly submittedAt: string;
  readonly source: "mcp" | "form";
  readonly taskVersion: number;
  readonly selfCheck: {
    readonly outcome: "passed" | "changes" | "missing";
    readonly attempt: number;
    readonly firstPassedAttempt: number | null;
  } | null;
  readonly note: string;
  readonly reviewReport: {
    readonly criteria: readonly {
      readonly criterionId: string;
      readonly status: "confirmed" | "violation" | "not_verified";
      readonly evidence: string;
      readonly gap: string;
      readonly obtainedByRun: boolean;
    }[];
  } | null;
  readonly reportText: string | null;
  readonly serviceMark: {
    readonly repositoryUrl: string | null;
    readonly branch: string | null;
    readonly commit: string | null;
    readonly uncommittedChanges: boolean | null;
  };
  readonly authorFeedback: LegacyFeedbackFact | null;
}

export const legacyTaskSubmissionFacts: {
  readonly product: { readonly id: string; readonly name: string };
  readonly chapters: Readonly<
    Record<LegacyTaskKey, { readonly id: string; readonly name: string }>
  >;
  readonly tasks: Readonly<
    Record<
      LegacyTaskKey,
      {
        readonly code: string;
        readonly title: string;
        readonly chapter: LegacyTaskKey;
        readonly currentVersion: number;
      }
    >
  >;
  readonly people: Readonly<
    Record<
      LegacyPersonKey,
      {
        readonly accountId: string;
        readonly telegramIdentityRef: string | null;
        readonly displayName: string | null;
        readonly telegramUsername: string | null;
        readonly telegramUrl: string | null;
        readonly telegramContactState: "available" | "not_linked";
      }
    >
  >;
  readonly versions: readonly {
    readonly task: LegacyTaskKey;
    readonly version: number;
    readonly criteria: readonly LegacyCriterionFact[];
  }[];
  readonly requestsFeedback: LegacyFeedbackFact;
  readonly reviewed: readonly LegacySubmissionFact[];
  readonly navigationAdditional: LegacySubmissionFact;
};
