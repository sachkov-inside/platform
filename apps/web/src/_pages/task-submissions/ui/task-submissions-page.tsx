import { loadTaskSubmissions } from "../api/load-task-submissions.server";
import { selectionHref } from "../model/task-submissions";
import { presentTaskSubmissions } from "../model/task-submissions-presentation";
import { TaskSubmissionsState } from "./task-submissions-states";
import { TaskSubmissionsView } from "./task-submissions-view.client";

type SearchValue = string | string[] | undefined;

/** A single non-empty value of the address; repeats and blanks mean «not chosen». */
function single(value: SearchValue): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `/authoring/submissions`: the author's «Сдачи» section (#948). */
export async function TaskSubmissionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, SearchValue>>>;
}) {
  const params = await searchParams;
  const productId = single(params["productId"]);
  const chapterId = single(params["chapterId"]);
  const taskCode = single(params["task"]);
  const cursor = single(params["cursor"]);
  const submissionId = single(params["submission"]);
  const productCursor = single(params["productCursor"]);
  const selection = {
    ...(productId === undefined ? {} : { productId }),
    ...(chapterId === undefined ? {} : { chapterId }),
    ...(taskCode === undefined ? {} : { taskCode }),
  };
  const outcome = await loadTaskSubmissions(
    selection,
    cursor,
    submissionId,
    productCursor,
  );
  return outcome.kind === "ready" ? (
    <TaskSubmissionsView presentation={presentTaskSubmissions(outcome)} />
  ) : (
    <TaskSubmissionsState
      kind={outcome.kind}
      returnTo={selectionHref(selection, cursor, submissionId, productCursor)}
      listHref={selectionHref(selection, cursor, undefined, productCursor)}
    />
  );
}
