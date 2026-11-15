"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLayoutEffect, type MouseEvent } from "react";
import { Button } from "@/shared/ui/button";
import {
  applyCourseMenuCollapsed,
  courseMenuStorageKey,
  readCourseMenuCollapsed,
  saveCourseMenuCollapsed,
} from "../model/course-menu";
import styles from "./course-reading.module.css";

export const courseMenuId = "course-lesson-menu";
const collapseLabel = "Свернуть меню уроков";
const expandLabel = "Развернуть меню уроков";

/** CSS shows exactly one of the two controls, so focus moves to the one that just appeared. */
function toggle(event: MouseEvent<HTMLButtonElement>, collapsed: boolean) {
  saveCourseMenuCollapsed(collapsed);
  const frame = event.currentTarget.closest("[data-course-reading]");
  frame
    ?.querySelector<HTMLButtonElement>(
      collapsed ? "[data-course-menu-expand]" : "[data-course-menu-collapse]",
    )
    ?.focus();
}

export function CourseMenuCollapseButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={styles["menuCollapse"]}
      aria-label={collapseLabel}
      title={collapseLabel}
      aria-expanded={true}
      aria-controls={courseMenuId}
      data-course-menu-collapse
      onClick={(event) => {
        toggle(event, true);
      }}
    >
      <PanelLeftClose aria-hidden="true" />
    </Button>
  );
}

/** The collapsed desktop menu: one expand control in the rail's place (#2158, owner 2026-11-15). */
export function CourseMenuStrip() {
  // Client-only renders and other tabs have no inline restore; read the saved choice here too.
  useLayoutEffect(() => {
    applyCourseMenuCollapsed(readCourseMenuCollapsed());
    const sync = (event: StorageEvent) => {
      if (event.key === courseMenuStorageKey || event.key === null)
        applyCourseMenuCollapsed(readCourseMenuCollapsed());
    };
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("storage", sync);
    };
  }, []);
  return (
    <div className={styles["menuStrip"]}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles["menuExpand"]}
        aria-label={expandLabel}
        title={expandLabel}
        aria-expanded={false}
        aria-controls={courseMenuId}
        data-course-menu-expand
        onClick={(event) => {
          toggle(event, false);
        }}
      >
        <PanelLeftOpen aria-hidden="true" />
      </Button>
    </div>
  );
}
