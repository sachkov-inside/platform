"use client";
import * as actions from "./api/communications.browser";
import { CommunicationsWorkspace } from "./ui/communications-workspace.client";
export function CommunicationsPage() {
  return <CommunicationsWorkspace actions={actions} />;
}
