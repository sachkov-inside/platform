import { loadTaskSubmissions } from "../api/load-task-submissions.server";
import { TaskSubmissionsState } from "./task-submissions-states";
import { TaskSubmissionsView } from "./task-submissions-view";

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
  const guideId = single(params["guideId"]);
  const chapterId = single(params["chapterId"]);
  const taskCode = single(params["task"]);
  const outcome = await loadTaskSubmissions(
    {
      ...(guideId === undefined ? {} : { guideId }),
      ...(chapterId === undefined ? {} : { chapterId }),
      ...(taskCode === undefined ? {} : { taskCode }),
    },
    single(params["cursor"]),
  );
  return outcome.kind === "ready" ? (
    <TaskSubmissionsView
      continued={outcome.continued}
      selection={outcome.selection}
      submissions={outcome.submissions}
    />
  ) : (
    <TaskSubmissionsState kind={outcome.kind} />
  );
}
