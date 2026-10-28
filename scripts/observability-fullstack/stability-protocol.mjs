// @ts-check
/** Closed diagnostic routing. The primary load dispatcher does not use this module. */
export const COLD_PROTOCOL = "fixed-actor-cold400-v1";
export const PRIMED_PROTOCOL = "fixed-actor-primed400-v1";
/** @typedef {{name:string,seconds:number,requests_per_second:number}} Definition */
/** @template {Record<string, unknown>} Result
 * @param {readonly string[]} args
 * @param {(definition:Definition,enabled:boolean,pair:number,ordinal:number)=>Promise<Result>} load
 */
export async function runStabilityPhase(args, load) {
  const [mode, text, selected = COLD_PROTOCOL] = args;
  const ordinal = Number(text);
  if (
    (args.length !== 2 && args.length !== 3) ||
    ![COLD_PROTOCOL, PRIMED_PROTOCOL].includes(selected) ||
    !["off", "on"].includes(mode ?? "") ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > 11 ||
    text !== String(ordinal) ||
    (mode === "on") !==
      [false, false, false, true, true, false][Math.floor(ordinal / 2)]
  )
    throw new Error("closed stability phase required");
  const warm = selected === PRIMED_PROTOCOL && ordinal % 2 === 0;
  const definition = {
    name: "spike",
    seconds: warm ? 20 : 10,
    requests_per_second: warm ? 20 : 40,
  };
  const result = await load(
    { ...definition },
    mode === "on",
    Math.floor(ordinal / 6),
    ordinal,
  );
  return {
    ...result,
    diagnostic_protocol: selected,
    diagnostic_definition: definition,
  };
}
