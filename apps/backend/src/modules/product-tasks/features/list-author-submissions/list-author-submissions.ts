import {
  checksKey,
  submissionSelfChecks,
  type SavedCheck,
  type SubmissionSelfCheck,
} from "./submission-self-checks.js";
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
const PRODUCT_FILTER_PAGE = 25;
const DIRECTORY_BATCH_SIZE = 100;
const productCursorValueSchema = z
  .object({ v: z.literal(1), kind: z.literal("products"), id: z.uuid() })
  .strict();

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();

/** The page cursor and size; the controller publishes these same schemas in OpenAPI. */
export const submissionsCursorSchema = z.string().min(1).max(200);
export const submissionsLimitSchema = z.number().int().min(1).max(100);

export const authorSubmissionsQuerySchema = z
  .object({
    productCursor: submissionsCursorSchema.optional(),
    submissionId: z.uuid().optional(),
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
  readonly selfCheck: SubmissionSelfCheck | null;
  readonly person: {
    readonly accountId: string;
    readonly telegramIdentityRef: string | null;
    readonly displayName: string | null;
    readonly telegramUsername: string | null;
    readonly telegramUrl: string | null;
    readonly telegramContactState: "available" | "not_linked" | "unavailable";
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
    /** Bounded Product choices plus the selected/page Products, never an implicit full catalogue. */
    readonly products: readonly SubmissionFilterProduct[];
    readonly submissions: readonly AuthorSubmission[];
    /** The criteria of every Task Version a listed submission refers to. */
    readonly versions: readonly {
      readonly code: string;
      readonly version: number;
      readonly criteria: TaskDefinition["criteria"];
    }[];
    readonly nextCursor: string | null;
    /** Independent continuation for the Product choices; submission cursors keep their existing scope. */
    readonly nextProductCursor: string | null;
    readonly history: readonly SavedCheck[];
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
  const productCursor =
    parsed.data.productCursor !== undefined
      ? decodeProductCursor(parsed.data.productCursor)
      : undefined;
  if (parsed.data.productCursor !== undefined && productCursor === undefined)
    return { ok: false, error: { code: "invalid_request_shape" } };
  const query = parsed.data;
  try {
    if (!(await dependencies.authorPolicy.canManage(actorId)))
      return { ok: false, error: { code: "forbidden" } };
    const taskScope = {
      ...(query.productId === undefined ? {} : { productId: query.productId }),
      ...(query.chapterId === undefined ? {} : { chapterId: query.chapterId }),
      ...(query.taskCode === undefined ? {} : { code: query.taskCode }),
    };
    const limit = query.limit ?? AUTHOR_SUBMISSIONS_PAGE;
    const rows = await dependencies.prisma.productTaskSubmission.findMany({
      where: {
        version: { task: taskScope },
        ...(query.submissionId === undefined ? {} : { id: query.submissionId }),
        ...(cursor === undefined || query.submissionId !== undefined
          ? {}
          : {
              OR: [
                { submittedAt: { lt: new Date(cursor.at) } },
                { submittedAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { feedback: true },
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    // Filter choices have their own bounded continuation; selected/page facts remain complete.
    const productWindow = await dependencies.prisma.productTask.groupBy({
      by: ["productId"],
      orderBy: { productId: "asc" },
      take: PRODUCT_FILTER_PAGE + 1,
      ...(productCursor === undefined
        ? {}
        : { where: { productId: { gt: productCursor.id } } }),
    });
    const filterProductIds = productWindow
      .slice(0, PRODUCT_FILTER_PAGE)
      .map(({ productId }) => productId);
    const tasks = await dependencies.prisma.productTask.findMany({
      where: {
        OR: [
          { productId: { in: filterProductIds } },
          { id: { in: [...new Set(page.map(({ taskId }) => taskId))] } },
          ...(query.productId === undefined
            ? []
            : [{ productId: query.productId }]),
          ...(query.chapterId === undefined
            ? []
            : [{ chapterId: query.chapterId }]),
          ...(query.taskCode === undefined ? [] : [{ code: query.taskCode }]),
        ],
      },
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
    const productIds = [...new Set(tasks.map(({ productId }) => productId))];
    const products = [];
    for (
      let offset = 0;
      offset < productIds.length;
      offset += DIRECTORY_BATCH_SIZE
    )
      products.push(
        ...(await dependencies.directory.products({
          ids: productIds.slice(offset, offset + DIRECTORY_BATCH_SIZE),
        })),
      );
    const productOf = new Map(products.map((product) => [product.id, product]));
    const chapterOf = new Map(
      products.flatMap((product) =>
        product.chapters.map((chapter) => [chapter.id, chapter]),
      ),
    );
    const lastFilterProduct = productWindow[PRODUCT_FILTER_PAGE - 1];
    const checks = await submissionSelfChecks(dependencies.prisma, page);
    const accounts = [...new Set(page.map((row) => row.accountId))];
    const [contacts, names] = await Promise.all([
      dependencies.identities.readContacts(accounts),
      dependencies.names.read(accounts),
    ]);
    if (!contacts.ok || !names.ok)
      return {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      };
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
        nextProductCursor:
          productWindow.length > PRODUCT_FILTER_PAGE &&
          lastFilterProduct !== undefined
            ? Buffer.from(
                JSON.stringify({
                  v: 1,
                  kind: "products",
                  id: lastFilterProduct.productId,
                }),
                "utf8",
              ).toString("base64url")
            : null,
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
            selfCheck: checks.bySubmission.get(row.id) ?? null,
            person: {
              accountId: row.accountId,
              telegramIdentityRef:
                contacts.contacts.get(row.accountId)?.telegramIdentityRef ??
                null,
              displayName:
                names.names.get(row.accountId) ??
                contacts.contacts.get(row.accountId)?.displayName ??
                null,
              telegramUsername:
                contacts.contacts.get(row.accountId)?.telegramUsername ?? null,
              telegramUrl:
                contacts.contacts.get(row.accountId)?.telegramUrl ?? null,
              telegramContactState:
                contacts.contacts.get(row.accountId)?.telegramContactState ??
                "unavailable",
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
        history:
          query.submissionId === undefined || page[0] === undefined
            ? []
            : (checks.history.get(checksKey(page[0])) ?? []),
        nextCursor:
          query.submissionId === undefined &&
          rows.length > limit &&
          last !== undefined
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

function decodeProductCursor(value: string) {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = productCursorValueSchema.safeParse(decoded);
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not a dependency failure: filter continuation is malformed foreign input.
    return undefined;
  }
}
