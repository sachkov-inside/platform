"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  changeCourseMenuFromControl,
  mountCourseMenuStrip,
} from "./course-menu.browser";
import styles from "./course-reading.module.css";

export const courseMenuId = "course-lesson-menu";
const collapseLabel = "Свернуть меню уроков";
const expandLabel = "Развернуть меню уроков";

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
        changeCourseMenuFromControl(event.currentTarget, true);
      }}
    >
      <PanelLeftClose aria-hidden="true" />
    </Button>
  );
}

/** The collapsed desktop menu: one expand control in the rail's place (#2158, owner 2026-11-15). */
export function CourseMenuStrip() {
  return (
    <div ref={mountCourseMenuStrip} className={styles["menuStrip"]}>
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
          changeCourseMenuFromControl(event.currentTarget, false);
        }}
      >
        <PanelLeftOpen aria-hidden="true" />
      </Button>
    </div>
  );
}
