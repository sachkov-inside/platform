// @ts-check
import { z } from "zod";

/** @type {readonly ["desktop-chromium", "mobile-chromium"]} */
export const fullStackProjects = Object.freeze([
  "desktop-chromium",
  "mobile-chromium",
]);
export const fullStackBrowserCommand = "test:fullstack";

/** @param {NodeJS.ProcessEnv} environment */
export function fullStackTestArguments(environment) {
  const args = ["--filter", "@inside/web", fullStackBrowserCommand];
  const project = environment["FULLSTACK_TEST_PROJECT"];
  if (project !== undefined) {
    args.push("--project", z.enum(fullStackProjects).parse(project));
  }
  const shard = environment["FULLSTACK_TEST_SHARD"];
  if (shard !== undefined) {
    args.push("--shard", z.enum(["1/2", "2/2"]).parse(shard));
  }
  const grep = environment["FULLSTACK_TEST_GREP"]?.trim();
  if (grep !== undefined && grep.length > 0) args.push("--grep", grep);
  return args;
}
