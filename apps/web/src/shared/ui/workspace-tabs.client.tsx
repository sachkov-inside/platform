"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "./workspace-tabs.css";

export interface WorkspaceTab {
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
}

/** Keeps drafts, previews and retry identities alive while another task is visible. */
export function WorkspaceTabs({
  tabs,
  label,
  initialId,
}: {
  readonly tabs: readonly [WorkspaceTab, ...WorkspaceTab[]];
  readonly label: string;
  readonly initialId?: string;
}) {
  const [selectedId, setSelectedId] = useState(initialId ?? tabs[0].id);
  const id = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const current = tabs.find((tab) => tab.id === selectedId) ?? tabs[0];

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === current.id);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (index - 1 + tabs.length) % tabs.length
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (next === undefined) return;
    setSelectedId(next.id);
    buttons.current.get(next.id)?.focus();
  }

  return (
    <div className="workspace-tasks">
      <div
        className="workspace-tabs"
        role="tablist"
        aria-label={label}
        onKeyDown={navigate}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current.id}
            aria-controls={`${id}-panel-${tab.id}`}
            id={`${id}-tab-${tab.id}`}
            tabIndex={tab.id === current.id ? 0 : -1}
            ref={(node) => {
              if (node === null) buttons.current.delete(tab.id);
              else buttons.current.set(tab.id, node);
            }}
            onClick={() => {
              setSelectedId(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="workspace-tab-panel"
          role="tabpanel"
          id={`${id}-panel-${tab.id}`}
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={tab.id !== current.id}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
