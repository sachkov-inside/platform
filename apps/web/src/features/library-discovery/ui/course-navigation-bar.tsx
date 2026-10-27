import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import type { ReactNode } from "react";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import styles from "./course-navigation-bar.module.css";

/** The same navigation surface follows the reader from overview to programme and lessons. */
export function CourseNavigationBar({
  children,
  label,
  position,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly position?: ReactNode;
}) {
  return (
    <nav aria-label={label} className={styles["bar"]}>
      {position === undefined ? null : (
        <div className={styles["position"]}>{position}</div>
      )}
      <div className={styles["items"]}>{children}</div>
    </nav>
  );
}

type NavigationItemProps = {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly current?: boolean;
} & (
  | { readonly href: Route }
  | {
      readonly onClick: () => void;
      readonly disabled?: boolean;
      readonly opensProgramme?: boolean;
    }
);

export function CourseNavigationItem(props: NavigationItemProps) {
  const Icon = props.icon;
  const content = (
    <>
      <Icon size={18} aria-hidden="true" />
      <span>{props.label}</span>
    </>
  );
  return "href" in props ? (
    <IntentPrefetchLink
      className={styles["item"]}
      href={props.href}
      aria-current={props.current === true ? "page" : undefined}
    >
      {content}
    </IntentPrefetchLink>
  ) : (
    <button
      className={styles["item"]}
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-current={props.current === true ? "true" : undefined}
      aria-haspopup={props.opensProgramme === true ? "dialog" : undefined}
      aria-label={props.opensProgramme === true ? "Вся программа" : undefined}
    >
      {content}
    </button>
  );
}
