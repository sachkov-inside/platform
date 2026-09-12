import type { InsideMcpToolDependencies } from "../../src/entrypoints/mcp/inside-mcp-server.js";
import { stubMaterialAuthoring } from "./material-authoring.js";

const refuse = () =>
  Promise.resolve({ ok: false as const, error: { code: "forbidden" as const } });

/**
 * Зависимости, отказывающие в любом вызове. Состав набора инструментов от их поведения не
 * зависит: инструмент обращается к зависимости только внутри вызова.
 */
export function refusingMcpToolDependencies(): Omit<InsideMcpToolDependencies, "accountId"> {
  return {
    authoring: stubMaterialAuthoring(),
    billing: { execute: refuse },
    communications: { execute: refuse },
    videos: { attachExisting: refuse, initUpload: refuse, reconcile: refuse },
  };
}
