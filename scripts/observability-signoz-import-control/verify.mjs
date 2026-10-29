// @ts-check
import { verify } from "../observability-signoz/verify.mjs";

const result = await verify({
  args: [
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-signoz-import-control",
    "-p",
    "test_*.py",
  ],
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.reason === "exit" ? (result.code ?? 1) : 1;
