// @ts-check
import { promisify } from "node:util";
const send = promisify(process.send.bind(process));
await send({ type: "ready" });
for (let index = 0; index < 16; index++) {
  await send({
    type: "inside:runner-probe",
    args: [{ index, report: "x".repeat(256 * 1024) }],
  });
}
process.exit(0);
