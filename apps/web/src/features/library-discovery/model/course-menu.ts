/**
 * The reader's choice to collapse the desktop lesson menu (#2158). It lives in this browser only
 * and is applied as an attribute on the document element, so the server-rendered course frame
 * shows the remembered state before the first paint without a client re-render.
 */
export const courseMenuStorageKey = "inside.course-menu.v1";
export const courseMenuAttribute = "data-course-menu";

/** Runs inline before the shell markup; it must stay self-contained and must never throw. */
export const courseMenuRestoreSource = `try{if(localStorage.getItem(${JSON.stringify(
  courseMenuStorageKey,
)})==="collapsed")document.documentElement.setAttribute(${JSON.stringify(
  courseMenuAttribute,
)},"collapsed")}catch(e){}`;

export function readCourseMenuCollapsed(): boolean {
  try {
    return localStorage.getItem(courseMenuStorageKey) === "collapsed";
  } catch {
    return false;
  }
}

export function applyCourseMenuCollapsed(collapsed: boolean): void {
  if (collapsed)
    document.documentElement.setAttribute(courseMenuAttribute, "collapsed");
  else document.documentElement.removeAttribute(courseMenuAttribute);
}

export function saveCourseMenuCollapsed(collapsed: boolean): void {
  applyCourseMenuCollapsed(collapsed);
  try {
    if (collapsed) localStorage.setItem(courseMenuStorageKey, "collapsed");
    else localStorage.removeItem(courseMenuStorageKey);
  } catch {
    // Blocked or full storage: the choice lasts until the page reloads.
  }
}
