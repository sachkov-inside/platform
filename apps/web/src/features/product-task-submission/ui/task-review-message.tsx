import { Bot, PenLine, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { formatSubmissionMoment } from "@/entities/product-task";
import styles from "./task-submission-workspace.module.css";

/** Messages display server-authored text; the page does not simulate agent dialogue. */
export function TaskReviewMessage({
  author,
  at,
  children,
}: {
  readonly author: "Агент" | "Автор" | "Ты";
  readonly at?: string | null;
  readonly children: ReactNode;
}) {
  const Icon =
    author === "Агент" ? Bot : author === "Автор" ? PenLine : UserRound;
  return (
    <div className={styles["message"]} data-task-review-message>
      <span className={styles["messageAvatar"]} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className={styles["messageContent"]}>
        <div className={styles["messageMeta"]}>
          <span className="font-medium text-foreground">{author}</span>
          {at == null ? null : (
            <time dateTime={at}>{formatSubmissionMoment(at)}</time>
          )}
        </div>
        <div className={styles["messageBubble"]}>{children}</div>
      </div>
    </div>
  );
}
