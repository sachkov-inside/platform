// @ts-check
/** @param {string} hostname @param {{family:number}} options */
export async function lookup(hostname, options) {
  if (hostname !== "inside-web-http" || options.family !== 4)
    throw new Error("owned telemetry alias required");
  return { address: "127.0.0.1", family: 4 };
}
