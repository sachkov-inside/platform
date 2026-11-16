export type LearningLessonKey = "intro" | "project" | "release" | "reference";
export const learningScenario: {
  readonly fixtureDate: string;
  readonly format: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  };
  readonly product: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
  };
  readonly topic: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly lessons: readonly {
    readonly key: LearningLessonKey;
    readonly slug: string;
    readonly id: string;
    readonly title: string;
    readonly access: "free" | "closed";
    readonly summary: string;
  }[];
  readonly chapters: readonly {
    readonly key: string;
    readonly id: string;
    readonly name: string;
    readonly lessons: readonly LearningLessonKey[];
    readonly supplementary: readonly LearningLessonKey[];
  }[];
  readonly artifact: {
    readonly id: string;
    readonly sourceId: string;
    readonly title: string;
    readonly purpose: string;
    readonly access: "free";
    readonly filename: string;
    readonly contentType: string;
    readonly text: string;
  };
  readonly learning: {
    readonly role: "holder";
    readonly completed: readonly LearningLessonKey[];
    readonly started: LearningLessonKey;
    readonly openedParts: number;
    readonly bookmark: LearningLessonKey;
  };
  readonly glossary: {
    readonly id: string;
    readonly title: string;
    readonly englishTitle: string;
    readonly shortDefinition: string;
    readonly fullDefinition: string;
    readonly introducedIn: LearningLessonKey;
  };
  readonly task: {
    readonly code: string;
    readonly title: string;
    readonly access: "closed";
    readonly currentVersion: number;
    readonly chapter: string;
    readonly after: LearningLessonKey;
    readonly definition: {
      readonly schemaVersion: 1;
      readonly situation: string;
      readonly result: readonly string[];
      readonly freedom: string;
      readonly criteria: readonly {
        readonly id: string;
        readonly level: "required";
        readonly requirement: string;
        readonly acceptableEvidence: readonly string[];
      }[];
    };
    readonly outdatedSubmissionNote: string;
    readonly submission: { readonly note: string };
    readonly feedback: { readonly comment: string; readonly reviewed: boolean };
  };
};
