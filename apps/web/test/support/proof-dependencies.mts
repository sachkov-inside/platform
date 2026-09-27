// Types for repository proof scripts that load web test dependencies through createRequire. A type
// import from a relative path into node_modules cannot resolve these packages' own imports.
export * from "@playwright/test";
export { AxeBuilder } from "@axe-core/playwright";
