"use client";
import { useId } from "react";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "@/shared/ui/workspace-tabs.client";

export type AccessTab = WorkspaceTab;

export function AccessSection({
  tabs,
}: {
  readonly tabs: readonly [AccessTab, ...AccessTab[]];
}) {
  const id = useId();
  return (
    <main
      aria-labelledby={id}
      className="authoring-page"
      data-access-section
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body">
        <header className="authoring-page-heading">
          <h1 id={id}>Люди и доступ</h1>
          <p>Участники, доступ к продуктам и личные приглашения.</p>
        </header>
        <WorkspaceTabs tabs={tabs} label="Разделы доступа" />
      </div>
    </main>
  );
}
