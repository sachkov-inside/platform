export declare const fullStackProjects: readonly [
  "desktop-chromium",
  "mobile-chromium",
];
export declare const fullStackBrowserCommand: "test:fullstack";
export declare function fullStackTestArguments(
  environment: NodeJS.ProcessEnv,
): string[];
