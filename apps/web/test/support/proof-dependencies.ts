// Types for repository proofs loading the web application's installed React modules.
export type { ComponentType, ReactNode } from "react";
export type ReactModule = Pick<typeof import("react"), "createElement">;
export type ReactServerModule = Pick<
  typeof import("react-dom/server"),
  "renderToStaticMarkup"
>;
