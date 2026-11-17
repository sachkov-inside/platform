// @ts-check
import { legacyTaskSubmissionFacts } from "./legacy-task-submissions.mjs";

/** @param {import("./legacy-task-submissions.mjs").LegacySubmissionFact} fact */
function httpSubmission(fact) {
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

/** The existing navigation contract includes an additional unreviewed form submission. */
export function legacyTaskSubmissionsHttp() {
  const { product, chapters, tasks, reviewed, navigationAdditional, versions } =
    legacyTaskSubmissionFacts;
  return {
    products: [
      {
        ...product,
        chapters: Object.entries(chapters).map(([key, chapter]) => ({
          ...chapter,
          tasks: Object.values(tasks)
            .filter((task) => task.chapter === key)
            .map(({ code, title }) => ({ code, title })),
        })),
      },
    ],
    submissions: [...reviewed, navigationAdditional].map(httpSubmission),
    versions: versions.map((version) => ({
      code: tasks[version.task].code,
      version: version.version,
      criteria: version.criteria.map((criterion) => ({
        ...criterion,
        acceptableEvidence: [...criterion.acceptableEvidence],
      })),
    })),
    nextCursor: null,
    history: [],
    nextProductCursor: null,
  };
}
