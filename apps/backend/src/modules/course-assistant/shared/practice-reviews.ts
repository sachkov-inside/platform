import { z } from "zod";
import type { CourseAssistantPrismaClient } from "../../../infrastructure/prisma/index.js";
import {
  practiceReviewRowSelect,
  storedReport,
  toPracticeReviewView,
  type PracticeReviewRow,
  type PracticeReviewView,
} from "./practice-review-view.js";

/** Идентификатор практики из #785: `<source>:<practice>`; остальное решает Materials. */
export const practiceIdSchema = z.string().trim().min(1).max(200);

type ReviewPrisma = Pick<CourseAssistantPrismaClient, "practiceReview">;

/** Practice Review этого Account с изменениями относительно прошлой проверки. */
export async function readPracticeReviewView(
  prisma: ReviewPrisma,
  query: { readonly accountId: string; readonly reviewId: string },
): Promise<PracticeReviewView | null> {
  const row = await prisma.practiceReview.findFirst({
    where: { id: query.reviewId, accountId: query.accountId },
    select: practiceReviewRowSelect,
  });
  if (row === null) return null;
  const [view] = await toViews(prisma, [row]);
  return view ?? null;
}

/** Представления проверок; отчёты прошлых проверок читаются одним запросом. */
export async function toViews(
  prisma: ReviewPrisma,
  rows: readonly PracticeReviewRow[],
): Promise<readonly PracticeReviewView[]> {
  const previousIds = rows
    .map(({ previousReviewId }) => previousReviewId)
    .filter((id) => id !== null);
  const previous =
    previousIds.length === 0
      ? []
      : await prisma.practiceReview.findMany({
          where: { id: { in: previousIds } },
          select: { id: true, report: true },
        });
  const reports = new Map(
    previous.map(({ id, report }) => [id, storedReport(report)]),
  );
  return rows.map((row) =>
    toPracticeReviewView(
      row,
      row.previousReviewId === null
        ? null
        : (reports.get(row.previousReviewId) ?? null),
    ),
  );
}
