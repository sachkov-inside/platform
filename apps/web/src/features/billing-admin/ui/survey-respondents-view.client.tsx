"use client";
import { Button } from "@/shared/ui/button";
import { hasText } from "@/shared/lib/text";
import type { RespondentsView } from "../model/respondent-operations";
import { AdminSection } from "./admin-form.client";
export interface SurveyRespondentsViewProps {
  readonly data: RespondentsView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRefresh: () => void;
}
const issuedDate = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "Europe/Moscow",
});
/** Read-only archive: existing codes and historical facts are not rewritten by the new workflow. */
export function SurveyRespondentsView({
  data,
  loading,
  error,
  onRefresh,
}: SurveyRespondentsViewProps) {
  return (
    <AdminSection
      title="Архив анкетных скидок"
      description="Здесь сохранены сведения о прежних анкетных ссылках. Действующие ссылки продолжают работать."
    >
      <p className="text-sm leading-6">
        Новые ссылки создавайте в разделе{" "}
        <a
          className="text-action underline underline-offset-4"
          href="#payment-links"
        >
          «Ссылки на оплату»
        </a>
        . Право на анкетную скидку проверьте вручную.
      </p>
      <div>
        <Button variant="outline" onClick={onRefresh}>
          Обновить архив
        </Button>
      </div>
      {loading && <p role="status">Загружаем архив…</p>}
      {hasText(error) && <p role="alert">{error}</p>}
      {data !== null && (
        <>
          <dl className="grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">В списке</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {data.total}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ссылок выдано</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {data.issued}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Купили по ссылке</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {data.purchased}
              </dd>
            </div>
          </dl>
          {data.total === 0 ? (
            <p>В архиве пока нет анкетных ссылок.</p>
          ) : (
            <details>
              <summary className="cursor-pointer font-semibold">
                Весь список
              </summary>
              <ul className="mt-3 grid gap-1 text-sm">
                {data.respondents.map((row) => (
                  <li
                    className="flex min-w-0 flex-wrap justify-between gap-x-4"
                    key={row.username}
                  >
                    <span className="break-all font-mono">@{row.username}</span>
                    <span className="text-muted-foreground">
                      {row.purchased
                        ? "купил"
                        : row.issuedAt === null
                          ? "ссылки нет"
                          : `ссылка выдана ${issuedDate.format(new Date(row.issuedAt))}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </AdminSection>
  );
}
