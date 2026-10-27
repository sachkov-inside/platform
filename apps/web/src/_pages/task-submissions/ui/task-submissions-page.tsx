import { loadTaskSubmissions } from "../api/load-task-submissions.server";
import {
  parseSubmissionsAddress,
  submissionsListHref,
} from "../model/task-submissions";
import { presentTaskSubmissions } from "../model/task-submissions-presentation";
import { TaskSubmissionsState } from "./task-submissions-states";
import { TaskSubmissionsView } from "./task-submissions-view.client";

type SearchValue = string | string[] | undefined;

/** `/authoring/submissions`: the author's «Сдачи» section (#948, #1717). */
export async function TaskSubmissionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, SearchValue>>>;
}) {
  const address = parseSubmissionsAddress(await searchParams);
  const { selection, feedback, cursor, submissionId, productCursor } = address;
  const outcome = await loadTaskSubmissions(
    selection,
    cursor,
    submissionId,
    productCursor,
    feedback,
  );
  return outcome.kind === "ready" ? (
    <TaskSubmissionsView presentation={presentTaskSubmissions(outcome)} />
  ) : (
    <TaskSubmissionsState
      kind={outcome.kind}
      returnTo={submissionsListHref(address)}
      listHref={submissionsListHref({ ...address, submissionId: undefined })}
    />
  );
}
