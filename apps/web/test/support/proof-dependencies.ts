// Types for repository proofs loading the web application's installed React modules.
import type { createElement } from "react";
import type { renderToStaticMarkup } from "react-dom/server";

export type { ComponentType, ReactNode } from "react";
export type ReactModule = { createElement: typeof createElement };
export type ReactServerModule = {
  renderToStaticMarkup: typeof renderToStaticMarkup;
};
