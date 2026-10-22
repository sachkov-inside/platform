import { loadPersonalHomeOperation } from "./reading-progress.operation";

export async function loadPersonalHome() {
  const result = await loadPersonalHomeOperation.send({});
  if (result.kind === "unavailable")
    throw new Error("Personal Home is unavailable");
  return result;
}
