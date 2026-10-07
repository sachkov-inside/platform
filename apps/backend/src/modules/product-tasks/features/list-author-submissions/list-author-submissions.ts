import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  reviewReportSchema,
  type ReviewReport,
} from "../../domain/review-report.js";
import {
  submissionSourceSchema,
  taskCodeSchema,
  taskDefinitionSchema,
  type SubmissionSource,
  type TaskDefinition,
} from "../../domain/task-definition.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";
import {
  authorFeedbackOf,
  type AuthorFeedback,
} from "../../shared/author-feedback.js";
import type { SubmissionReviewDependencies } from "../../shared/submission-review-dependencies.js";

const AUTHOR_SUBMISSIONS_PAGE = 25;

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();

/** The page cursor and size; the controller publishes these same schemas in OpenAPI. */
export const submissionsCursorSchema = z.string().min(1).max(200);
export const submissionsLimitSchema = z.number().int().min(1).max(100);

export const authorSubmissionsQuerySchema = z
  .object({
    productId: z.uuid().optional(),
    chapterId: z.uuid().optional(),
    taskCode: taskCodeSchema.optional(),
    cursor: submissionsCursorSchema.nullable().optional(),
    limit: z.coerce.number().pipe(submissionsLimitSchema).optional(),
  })
  .strict();

export interface AuthorSubmission {
  readonly submissionId: string;
  readonly submittedAt: string;
  readonly source: SubmissionSource;
  readonly task: {
    readonly code: string;
    readonly title: string;
    readonly productId: string;
    /** `null` when the Product is no longer in the catalog. */
    readonly productName: string | null;
    readonly chapterId: string;
    /**
     * `null` when the author removed the chapter after import: the task keeps its submissions,
     * which stay readable here.
     */
    readonly chapterName: string | null;
    readonly currentVersion: number;
  };
  readonly taskVersion: number;
  readonly person: {
    readonly accountId: string;
    readonly telegramIdentityRef: string | null;
  };
  readonly note: string;
  /** The learner agent's report: untrusted text, never a Platform verdict. */
  readonly reviewReport: ReviewReport | null;
  /** The learner's own report typed into the page form. */
  readonly reportText: string | null;
  readonly serviceMark: {
    readonly repositoryUrl: string | null;
    readonly branch: string | null;
    readonly commit: string | null;
    readonly uncommittedChanges: boolean | null;
  };
  readonly authorFeedback: AuthorFeedback | null;
}

/** A Product in the section filter: its chapters with tasks, chapters in author order. */
export interface SubmissionFilterProduct {
  readonly id: string;
  readonly name: string;
  readonly chapters: readonly {
    readonly id: string;
    readonly name: string;
    readonly tasks: readonly {
      readonly code: string;
      readonly title: string;
    }[];
  }[];
}

export type ListAuthorSubmissionsError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | SystemError;

export type AuthorSubmissionsResult = Result<
  {
    readonly products: readonly SubmissionFilterProduct[];
    readonly submissions: readonly AuthorSubmission[];
    /** The criteria of every Task Version a listed submission refers to. */
    readonly versions: readonly {
      readonly code: string;
      readonly version: number;
      readonly criteria: TaskDefinition["criteria"];
    }[];
    readonly nextCursor: string | null;
  },
  ListAuthorSubmissionsError
>;

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ at: at.toISOString(), id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): z.infer<typeof cursorSchema> | null {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    // Not a dependency failure: a cursor is foreign input and a malformed one is a bad request.
    return null;
  }
}

/**
 * Submissions for the author, newest first, narrowed by Product, chapter and task (#948). Published
 * and unpublished tasks alike: a task taken off publication keeps its submissions for reviews.
 */
export async function listAuthorSubmissions(
  dependencies: SubmissionReviewDependencies,
  actorId: string,
  input: unknown,
): Promise<AuthorSubmissionsResult> {
  const parsed = authorSubmissionsQuerySchema.safeParse(input);
  const cursor =
    parsed.success &&
    parsed.data.cursor !== undefined &&
    parsed.data.cursor !== null
      ? decodeCursor(parsed.data.cursor)
      : undefined;
  if (!parsed.success || cursor === null)
    return { ok: false, error: { code: "invalid_request_shape" } };
  const query = parsed.data;
  try {
    if (!(await dependencies.authorPolicy.canManage(actorId)))
      return { ok: false, error: { code: "forbidden" } };
    const tasks = await dependencies.prisma.productTask.findMany({
      orderBy: [{ position: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        title: true,
        productId: true,
        chapterId: true,
        currentVersion: true,
      },
    });
    const products = await dependencies.directory.products({
      ids: [...new Set(tasks.map((task) => task.productId))],
    });
    const productOf = new Map(products.map((product) => [product.id, product]));
    const chapterOf = new Map(
      products.flatMap((product) =>
        product.chapters.map((chapter) => [chapter.id, chapter]),
      ),
    );
    const selected = tasks.filter(
      (task) =>
        (query.productId === undefined || task.productId === query.productId) &&
        (query.chapterId === undefined || task.chapterId === query.chapterId) &&
        (query.taskCode === undefined || task.code === query.taskCode),
    );
    const limit = query.limit ?? AUTHOR_SUBMISSIONS_PAGE;
    const rows =
      selected.length === 0
        ? []
        : await dependencies.prisma.productTaskSubmission.findMany({
            where: {
              taskId: { in: selected.map((task) => task.id) },
              ...(cursor === undefined
                ? {}
                : {
                    OR: [
                      { submittedAt: { lt: new Date(cursor.at) } },
                      {
                        submittedAt: new Date(cursor.at),
                        id: { lt: cursor.id },
                      },
                    ],
                  }),
            },
            orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            include: { feedback: true },
          });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const accounts = [...new Set(page.map((row) => row.accountId))];
    const bindings = await Promise.all(
      accounts.map((accountId) =>
        dependencies.identities.readBinding({ accountId }),
      ),
    );
    const telegramOf = new Map<string, string | null>();
    for (const [index, accountId] of accounts.entries()) {
      const binding = bindings[index];
      if (binding === undefined || !binding.ok)
        return {
          ok: false,
          error: { code: "dependency_unavailable", retryable: true },
        };
      telegramOf.set(accountId, binding.binding?.telegramIdentityRef ?? null);
    }
    const versionKeys = [
      ...new Map(
        page.map((row) => [
          `${row.taskId}:${String(row.taskVersion)}`,
          { taskId: row.taskId, version: row.taskVersion },
        ]),
      ).values(),
    ];
    const versions =
      versionKeys.length === 0
        ? []
        : await dependencies.prisma.productTaskVersion.findMany({
            where: { OR: versionKeys },
            orderBy: [{ taskId: "asc" }, { version: "desc" }],
          });
    const taskOf = new Map(tasks.map((task) => [task.id, task]));
    return {
      ok: true,
      value: {
        products: filterProducts(products, tasks),
        submissions: page.map((row) => {
          const task = taskOf.get(row.taskId);
          if (task === undefined)
            throw new Error("A submission refers to an unknown task");
          return {
            submissionId: row.id,
            submittedAt: row.submittedAt.toISOString(),
            source: submissionSourceSchema.parse(row.source),
            task: {
              code: task.code,
              title: task.title,
              productId: task.productId,
              productName: productOf.get(task.productId)?.name ?? null,
              chapterId: task.chapterId,
              chapterName: chapterOf.get(task.chapterId)?.name ?? null,
              currentVersion: task.currentVersion,
            },
            taskVersion: row.taskVersion,
            person: {
              accountId: row.accountId,
              telegramIdentityRef: telegramOf.get(row.accountId) ?? null,
            },
            note: row.note,
            reviewReport:
              row.reviewReport === null
                ? null
                : reviewReportSchema.parse(row.reviewReport),
            reportText: row.reportText,
            serviceMark: {
              repositoryUrl: row.repositoryUrl,
              branch: row.branch,
              commit: row.commitSha,
              uncommittedChanges: row.uncommittedChanges,
            },
            authorFeedback:
              row.feedback === null ? null : authorFeedbackOf(row.feedback),
          };
        }),
        versions: versions.map((version) => ({
          code: codeOf(taskOf, version.taskId),
          version: version.version,
          criteria: taskDefinitionSchema.parse(version.definition).criteria,
        })),
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor(last.submittedAt, last.id)
            : null,
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("listAuthorSubmissions"),
      error,
      systemFailure(error),
    );
  }
}

function codeOf(
  tasks: ReadonlyMap<string, { readonly code: string }>,
  taskId: string,
): string {
  const task = tasks.get(taskId);
  if (task === undefined)
    throw new Error("A version refers to an unknown task");
  return task.code;
}

/**
 * Products that have tasks, by name, with their chapters in author order and the tasks of each
 * chapter in chapter order.
 */
function filterProducts(
  products: Awaited<
    ReturnType<SubmissionReviewDependencies["directory"]["products"]>
  >,
  tasks: readonly {
    readonly code: string;
    readonly title: string;
    readonly productId: string;
    readonly chapterId: string;
  }[],
): readonly SubmissionFilterProduct[] {
  return [...products]
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name, "ru");
      return byName === 0 ? left.id.localeCompare(right.id) : byName;
    })
    .map((product) => ({
      id: product.id,
      name: product.name,
      chapters: product.chapters
        .map((chapter) => ({
          id: chapter.id,
          name: chapter.name,
          tasks: tasks
            .filter(
              (task) =>
                task.productId === product.id && task.chapterId === chapter.id,
            )
            .map((task) => ({ code: task.code, title: task.title })),
        }))
        .filter((chapter) => chapter.tasks.length > 0),
    }))
    .filter((product) => product.chapters.length > 0);
}
