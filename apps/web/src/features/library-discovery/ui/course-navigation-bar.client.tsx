"use client";

import { ChevronUp, type LucideIcon } from "lucide-react";
import type { Route } from "next";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import styles from "./course-navigation-bar.module.css";

/** Compact navigation belongs to learning, never to the course landing page. */
export function CourseNavigationBar({
  children,
  label,
  reserveSpace = false,
  layout = "sections",
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly reserveSpace?: boolean;
  /** The lesson dock is wider, stays on tablets and gives previous/next their own surfaces. */
  readonly layout?: "sections" | "lesson";
}) {
  const bar = useRef<HTMLElement>(null);
  const [space, setSpace] = useState(0);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!reserveSpace || element === null) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      const bottom = Number.parseFloat(getComputedStyle(element).bottom);
      setSpace(height === 0 ? 0 : height + bottom + 12);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [reserveSpace]);
  return (
    <>
      {reserveSpace ? (
        <div
          aria-hidden="true"
          className={styles["space"]}
          style={{ height: space }}
        />
      ) : null}
      <nav
        ref={bar}
        aria-label={label}
        className={styles["bar"]}
        data-layout={layout}
      >
        <div className={styles["items"]}>{children}</div>
      </nav>
    </>
  );
}

type NavigationItemProps = {
  readonly icon?: LucideIcon;
  readonly label: string;
  readonly caption?: ReactNode;
  readonly title?: string;
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
  const captionId = useId();
  const content = (
    <>
      {Icon === undefined ? null : <Icon size={16} aria-hidden="true" />}
      <span className={styles["label"]} aria-hidden="true">
        {props.caption === undefined ? null : (
          <small id={captionId}>{props.caption}</small>
        )}
        <span>{props.label}</span>
      </span>
      {"opensProgramme" in props && props.opensProgramme ? (
        <ChevronUp size={16} aria-hidden="true" className={styles["opens"]} />
      ) : null}
    </>
  );
  return "href" in props ? (
    <IntentPrefetchLink
      className={styles["item"]}
      href={props.href}
      title={props.title ?? props.label}
      aria-label={props.label}
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
      title={props.opensProgramme === true ? "Вся программа" : props.label}
      aria-current={props.current === true ? "true" : undefined}
      aria-haspopup={props.opensProgramme === true ? "dialog" : undefined}
      aria-label={props.opensProgramme === true ? "Вся программа" : props.label}
      // The visible position or progress stays available to screen readers.
      aria-describedby={props.caption === undefined ? undefined : captionId}
    >
      {content}
    </button>
  );
}
