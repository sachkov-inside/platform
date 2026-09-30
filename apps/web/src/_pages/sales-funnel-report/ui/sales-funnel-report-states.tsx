import { CircleAlert, LockKeyhole, LogIn, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui/button";
import { StatusPanel } from "@/shared/ui/status-panel";

import { SalesFunnelReportFrame } from "./sales-funnel-report-view";

const reportHref = "/authoring/sales-funnel";

export function SalesFunnelReportState({
  kind,
}: {
  readonly kind: "unauthorized" | "forbidden" | "unavailable";
}) {
  return (
    <SalesFunnelReportFrame>
      {kind === "unauthorized" ? (
        <StatusPanel
          action={
            <form action="/auth/sign-in" method="post">
              <input name="returnTo" type="hidden" value={reportHref} />
              <Button type="submit">
                <LogIn aria-hidden="true" data-icon="inline-start" />
                Войти
              </Button>
            </form>
          }
          icon={<LogIn aria-hidden="true" />}
          message="Отчёт виден только владельцу после входа."
          state={{ "data-sales-funnel-state": "unauthorized" }}
          title="Нужен вход"
        />
      ) : kind === "forbidden" ? (
        <StatusPanel
          action={null}
          icon={<LockKeyhole aria-hidden="true" />}
          message="Отчёт воронки открыт тем, кто управляет оплатой: право billing:manage."
          state={{ "data-sales-funnel-state": "forbidden" }}
          title="Нет доступа к отчёту"
        />
      ) : (
        <StatusPanel
          action={
            <Button asChild variant="outline">
              <Link href={reportHref}>
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                Обновить
              </Link>
            </Button>
          }
          icon={<CircleAlert aria-hidden="true" />}
          message="Данные отчёта сейчас недоступны. Попробуйте обновить страницу чуть позже."
          state={{ "data-sales-funnel-state": "unavailable" }}
          title="Отчёт не загрузился"
        />
      )}
    </SalesFunnelReportFrame>
  );
}
