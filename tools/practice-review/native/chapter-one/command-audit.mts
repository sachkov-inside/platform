import { parse, quote } from "shell-quote";
import { readsOnly } from "../task-gates.mjs";

/** Conservative audit only; the container, not this recognizer, enforces isolation. */
export function unconsentedReviewCommands(
  commands: readonly string[],
): string[] {
  return commands.flatMap((line) => {
    try {
      return audit(line, 0);
    } catch {
      return [line];
    }
  });
}

function audit(line: string, depth: number): string[] {
  if (depth > 3 || /[\n\r]|\$\(|`/u.test(line)) return [line];
  // Empty environment avoids consulting host values while parsing untrusted command text.
  const tokens = parse(line, {});
  if (
    tokens.length === 3 &&
    typeof tokens[0] === "string" &&
    /^(?:\/bin\/)?(?:bash|sh|zsh)$/u.test(tokens[0]) &&
    (tokens[1] === "-c" || tokens[1] === "-lc") &&
    typeof tokens[2] === "string"
  )
    return audit(tokens[2], depth + 1);
  const units: string[][] = [];
  let words: string[] = [];
  const flush = () => {
    if (words.length > 0) units.push(words);
    words = [];
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (typeof token === "string") words.push(token);
    else if (token !== undefined && "comment" in token) continue;
    else if (token?.op === "glob") words.push(token.pattern);
    else if (
      token !== undefined &&
      [";", "&&", "||", "|", "|&", "&"].includes(token.op)
    )
      flush();
    else if (
      token !== undefined &&
      ((token.op === ">" && tokens[index + 1] === "/dev/null") ||
        (token.op === ">&" &&
          (tokens[index + 1] === "1" || tokens[index + 1] === "2")))
    ) {
      // Diagnostic-only redirects; project/file redirection remains unconsented.
      if (["1", "2"].includes(words.at(-1) ?? "")) words.pop();
      index += 1;
    } else return [line];
  }
  flush();
  return units.filter((unit) => !reading(unit)).map((unit) => quote(unit));
}

function reading(input: readonly string[]) {
  const words = [...input];
  const program = words[0] ?? "";
  if (program.includes("/") && !/^\/(?:usr\/)?bin\/[^/]+$/u.test(program))
    return false;
  words[0] = program.split("/").at(-1) ?? program;
  if (words[0] === "git") {
    if (words[1] === "--no-optional-locks") words.splice(1, 1);
    if (words[1] === "-C" && words[2] === "/project") words.splice(1, 2);
    if (words[1] === "config") {
      const flags = words.slice(2);
      if (["--local", "--global", "--system"].includes(flags[0] ?? ""))
        flags.shift();
      const operation = flags.shift();
      return (
        ["--get", "--get-all", "--get-regexp"].includes(operation ?? "") &&
        flags.length >= 1 &&
        flags.length <= 2 &&
        flags.every((value) => !value.startsWith("-"))
      );
    }
    if (
      words[1] === "ls-files" ||
      (words[1] === "worktree" && words[2] === "list")
    )
      return true;
  }
  if (words[0] === "sort")
    return words.length === 1 || (words.length === 2 && words[1] === "-u");
  return readsOnly(words.join(" "));
}
