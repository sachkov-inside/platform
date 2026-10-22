import {
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  TriangleAlert,
} from "lucide-react";
import type {
  TaskCriterion,
  TaskReviewReport,
} from "../model/product-task-page";

const statuses = {
  confirmed: { label: "Подтверждено", Icon: Check },
  violation: { label: "Есть замечание", Icon: TriangleAlert },
  not_verified: { label: "Не проверено", Icon: CircleHelp },
};

/** The report remains an agent statement; additional criteria do not change the required outcome. */
export function TaskReviewReportView({
  report,
  criteria,
}: {
  readonly report: TaskReviewReport;
  readonly criteria: readonly TaskCriterion[];
}) {
  const byId = new Map(report.criteria.map((item) => [item.criterionId, item]));
  const required = criteria.filter((item) => item.level === "required");
  const confirmed = required.filter(
    (item) => byId.get(item.id)?.status === "confirmed",
  ).length;
  const violations = required.filter(
    (item) => byId.get(item.id)?.status === "violation",
  ).length;
  const unverified = required.length - confirmed - violations;
  return (
    <div className="grid gap-3" data-task-review-report>
      <p className="sr-only">Самопроверка агента</p>
      {report.summary === undefined ? null : (
        <p className="whitespace-pre-line text-sm leading-6">
          {report.summary}
        </p>
      )}
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <FileText aria-hidden="true" className="size-4 shrink-0" />
          Отчёт по критериям
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 group-open:rotate-180"
          />
        </summary>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Подтверждено: {confirmed} из {required.length}
          </span>
          {violations === 0 ? null : <span>С замечаниями: {violations}</span>}
          {unverified === 0 ? null : <span>Не проверено: {unverified}</span>}
        </p>
        <ul className="divide-y divide-border">
          {criteria.map((criterion) => {
            const result = byId.get(criterion.id);
            if (result === undefined) return null;
            const { label, Icon } = statuses[result.status];
            return (
              <li
                key={criterion.id}
                className="grid gap-2 py-4 text-sm leading-6"
              >
                <p className="font-medium">
                  {"requirement" in criterion
                    ? criterion.requirement
                    : criterion.task}
                </p>
                <p className="flex items-center gap-2">
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                  {criterion.level === "additional" ? " · Дополнительно" : ""}
                </p>
                {result.evidence.length === 0 ? null : (
                  <p className="whitespace-pre-line text-muted-foreground">
                    {result.evidence}
                  </p>
                )}
                {result.gap.length === 0 ? null : (
                  <p className="whitespace-pre-line">
                    Что осталось: {result.gap}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
