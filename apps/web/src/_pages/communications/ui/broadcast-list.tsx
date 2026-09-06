import type { z } from "zod";
import { Button } from "@/shared/ui/button";
import { type broadcastListSchema, errorMessage } from "../model/broadcasts";
import { BroadcastStatus } from "./broadcast-status";
import styles from "./broadcasts.module.css";

export function BroadcastList({
  result,
  pending,
  selectedId,
  hasPrevious,
  onSelect,
  onNext,
  onFirst,
}: {
  readonly result: z.infer<typeof broadcastListSchema> | undefined;
  readonly pending: boolean;
  readonly selectedId?: string | undefined;
  readonly hasPrevious: boolean;
  readonly onSelect: (id: string) => void;
  readonly onNext: (cursor: string) => void;
  readonly onFirst: () => void;
}) {
  return (
    <section aria-label="Список рассылок" className={styles.list}>
      <header className={styles.listHeader}>
        <h2 className="text-lg font-semibold">Рассылки</h2>
        <span className={styles.hint}>Черновики и история отправок</span>
      </header>
      {!result ? (
        <p role="status" className={styles.empty}>
          Загружаем рассылки…
        </p>
      ) : result.kind === "error" ? (
        <p role="alert" className={styles.alert}>
          {errorMessage(result.code)}
        </p>
      ) : (
        <>
          {!result.broadcasts.length ? (
            <div className={styles.empty}>
              <p className="font-semibold text-foreground">
                Рассылок пока нет.
              </p>
              <p>
                Создайте первую рассылку: подготовьте сообщение, выберите
                аудиторию и время.
              </p>
            </div>
          ) : (
            <ul>
              {result.broadcasts.map((broadcast) => (
                <li key={broadcast.broadcastId}>
                  <button
                    className={styles.listRow}
                    type="button"
                    disabled={pending}
                    aria-pressed={selectedId === broadcast.broadcastId}
                    onClick={() => {
                      onSelect(broadcast.broadcastId);
                    }}
                  >
                    <span className="min-w-0">
                      <span className={styles.listTitle}>
                        {broadcast.parts
                          .find((part) => part.content.text)
                          ?.content.text.slice(0, 100) ?? "Рассылка с медиа"}
                      </span>
                      <span className={styles.listMeta}>
                        {broadcast.audience.kind === "all"
                          ? "Все контакты"
                          : `Выбранных воронок: ${String(broadcast.audience.funnelIds.length)}`}
                        {broadcast.scheduledAt
                          ? ` · ${new Date(broadcast.scheduledAt).toLocaleString("ru-RU", { timeZoneName: "short" })}`
                          : ""}
                        {broadcast.audienceSnapshotId
                          ? ` · Получателей в снимке: ${String(broadcast.snapshotSize)}`
                          : ""}
                      </span>
                    </span>
                    <BroadcastStatus state={broadcast.state} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {hasPrevious || (result?.kind === "ready" && result.nextCursor) ? (
        <nav aria-label="Страницы рассылок" className={styles.pagination}>
          {hasPrevious ? (
            <Button variant="outline" onClick={onFirst}>
              К началу списка
            </Button>
          ) : null}
          {result?.kind === "ready" && result.nextCursor ? (
            <Button
              variant="outline"
              onClick={() => {
                if (result.nextCursor) onNext(result.nextCursor);
              }}
            >
              Следующие рассылки
            </Button>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
