// @ts-check
import { spawn } from "node:child_process";
import { z } from "zod";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += String(chunk);
});
process.stdin.on("end", () => {
  const raw = /** @type {unknown} */ (JSON.parse(input));
  const request = z
    .object({
      program: z.string(),
      args: z.array(z.string()),
      input: z.string().optional(),
    })
    .strict()
    .parse(raw);
  const child = spawn(request.program, request.args, {
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin.on("error", () => {
    /* Failed commands may close stdin early. */
  });
  child.stdin.end(request.input);
  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("close", (code) => {
    process.exitCode = code ?? 1;
  });
});
