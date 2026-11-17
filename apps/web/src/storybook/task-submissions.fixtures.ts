import {
  legacyTaskSubmissionFacts,
  type LegacySubmissionFact,
} from "../../../../scenarios/legacy-task-submissions.mjs";
import type {
  AuthorSubmission,
  TaskSubmissions,
} from "@/_pages/task-submissions/model/task-submissions";

function storySubmission(fact: LegacySubmissionFact): AuthorSubmission {
  const { product, tasks, chapters, people } = legacyTaskSubmissionFacts;
  const task = tasks[fact.task];
  const chapter = chapters[task.chapter];
  return {
    submissionId: fact.id,
    submittedAt: fact.submittedAt,
    source: fact.source,
    task: {
      code: task.code,
      title: task.title,
      productId: product.id,
      productName: product.name,
      chapterId: chapter.id,
      chapterName: chapter.name,
      currentVersion: task.currentVersion,
    },
    taskVersion: fact.taskVersion,
    selfCheck: fact.selfCheck === null ? null : { ...fact.selfCheck },
    person: { ...people[fact.person] },
    note: fact.note,
    reviewReport:
      fact.reviewReport === null
        ? null
        : {
            criteria: fact.reviewReport.criteria.map((criterion) => ({
              ...criterion,
            })),
          },
    reportText: fact.reportText,
    serviceMark: { ...fact.serviceMark },
    authorFeedback:
      fact.authorFeedback === null ? null : { ...fact.authorFeedback },
  };
}

/** Three reviewed-list snapshots; HTTP navigation has a fourth, separately named case. */
export const reviewedSubmissions: TaskSubmissions = {
  history: [],
  products: [
    {
      ...legacyTaskSubmissionFacts.product,
      chapters: Object.entries(legacyTaskSubmissionFacts.chapters).map(
        ([key, chapter]) => ({
          ...chapter,
          tasks: Object.values(legacyTaskSubmissionFacts.tasks)
            .filter((task) => task.chapter === key)
            .map(({ code, title }) => ({ code, title })),
        }),
      ),
    },
  ],
  submissions: legacyTaskSubmissionFacts.reviewed.map(storySubmission),
  versions: legacyTaskSubmissionFacts.versions.map((version) => ({
    code: legacyTaskSubmissionFacts.tasks[version.task].code,
    version: version.version,
    criteria: version.criteria.map((criterion) => ({
      ...criterion,
      acceptableEvidence: [...criterion.acceptableEvidence],
    })),
  })),
  nextCursor: null,
  nextProductCursor: null,
};

export const submissionsProductId = legacyTaskSubmissionFacts.product.id;
export const submissionsSecondChapter =
  legacyTaskSubmissionFacts.chapters.requests.id;

/** The default view of the same fixture: only submissions without Author Feedback (#1717). */
export const awaitingSubmissions: TaskSubmissions = {
  ...reviewedSubmissions,
  submissions: reviewedSubmissions.submissions.filter(
    (row) => row.authorFeedback === null,
  ),
};

const learners = [
  [
    legacyTaskSubmissionFacts.people.anna.displayName,
    legacyTaskSubmissionFacts.people.anna.telegramUsername,
  ],
  [null, "konstantin_vasilevsky_dev"],
  [
    legacyTaskSubmissionFacts.people.mark.displayName,
    legacyTaskSubmissionFacts.people.mark.telegramUsername,
  ],
  ["Екатерина Александровна Иванова-Петрова", "katya_example"],
  ["Ольга Кравец", legacyTaskSubmissionFacts.people.olga.telegramUsername],
] as const;

/**
 * A long page: `count` deterministic submissions of the fixture tasks by five learners, every
 * third one commented, one hour apart and newest first. No randomness and no clock.
 */
export function manySubmissions(count: number): TaskSubmissions {
  const templates = reviewedSubmissions.submissions;
  return {
    ...reviewedSubmissions,
    submissions: Array.from({ length: count }, (_, index) => {
      const template = templates[index % templates.length];
      const learner = learners[index % learners.length];
      if (template === undefined || learner === undefined)
        throw new Error("fixture incomplete");
      const [displayName, username] = learner;
      return {
        ...template,
        submissionId: `31000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        submittedAt: new Date(
          Date.UTC(2026, 9, 24, 15, 40) - index * 3_600_000,
        ).toISOString(),
        person: {
          accountId: `11000000-0000-4000-8000-${String((index % learners.length) + 1).padStart(12, "0")}`,
          telegramIdentityRef:
            username === null ? null : `telegram:synthetic-${username}`,
          displayName,
          telegramUsername: username,
          telegramUrl: username === null ? null : `https://t.me/${username}`,
          telegramContactState: username === null ? "not_linked" : "available",
        },
        authorFeedback:
          index % 3 === 2
            ? {
                comment: legacyTaskSubmissionFacts.requestsFeedback.comment,
                reviewedAt: null,
                updatedAt: new Date(
                  Date.UTC(2026, 9, 24, 16, 0) - index * 3_600_000,
                ).toISOString(),
              }
            : null,
      };
    }),
    nextCursor: "page-2",
  };
}
