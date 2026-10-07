import type { LearnerMcpDependencies } from "../../src/modules/content-library/index.js";

export function refusingLearnerMcpDependencies(): LearnerMcpDependencies {
  const refuse = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "dependency_unavailable" as const,
        retryable: true as const,
      },
    });
  return {
    reader: {
      read: refuse,
      readPractice: refuse,
      listPractices: refuse,
      listProjections: refuse,
      discoverProjections: refuse,
      readHomePinnedSeries: refuse,
    },
    videos: { loadReadyDurations: refuse },
    tasks: {
      list: refuse,
      read: refuse,
      submit: refuse,
      submissions: refuse,
      page: refuse,
      chapterTasks: refuse,
    },
    contentAccess: {
      checkAvailabilityMany: () => Promise.resolve({ ok: true, items: [] }),
      authorize: () =>
        Promise.resolve({
          effect: "deny",
          reason: "resource_not_found",
          decisionId: "test",
          policyVersion: "content-access-v1",
          decidedAt: new Date().toISOString(),
        }),
      checkProductAccess: () => Promise.resolve({ kind: "closed" }),
    },
  };
}
