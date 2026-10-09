// @ts-check
import { createServer } from "node:net";
import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65535);
const portsSchema = z.object({
  EDITOR_LOCAL_GATEWAY_PORT: port.default(4396),
  EDITOR_LOCAL_API_PORT: port.default(4397),
  EDITOR_LOCAL_WEB_PORT: port.default(4398),
});

/** @param {NodeJS.ProcessEnv} [environment] */
export function editorLocalPorts(environment = process.env) {
  const parsed = portsSchema.parse(environment);
  const ports = {
    gateway: parsed.EDITOR_LOCAL_GATEWAY_PORT,
    api: parsed.EDITOR_LOCAL_API_PORT,
    web: parsed.EDITOR_LOCAL_WEB_PORT,
  };
  if (new Set(Object.values(ports)).size !== 3)
    throw new Error(
      "EDITOR_LOCAL_GATEWAY_PORT, EDITOR_LOCAL_API_PORT and EDITOR_LOCAL_WEB_PORT must be distinct",
    );
  return ports;
}

/** Browser and authoring transports normalize the default HTTP port in Host/Origin.
 * @param {ReturnType<typeof editorLocalPorts>} ports */
export function editorLocalEndpoints(ports) {
  const gateway = new URL(`http://127.0.0.1:${ports.gateway}`);
  const api = new URL(`http://127.0.0.1:${ports.api}`);
  return {
    gatewayHost: gateway.host,
    apiHost: api.host,
    webBaseUrl: gateway.origin,
    apiBaseUrl: api.origin,
  };
}

/** Probe before identity, migrations or child processes; never stop an existing listener.
 * @param {ReturnType<typeof editorLocalPorts>} ports */
export async function assertEditorPortsAvailable(ports) {
  for (const [name, value] of Object.entries(ports)) {
    await new Promise((done, reject) => {
      const server = createServer();
      server.once("error", (error) => {
        reject(
          new Error(
            `EDITOR_LOCAL_${name.toUpperCase()}_PORT ${value} is already in use or unavailable on 127.0.0.1; choose another port (${error.message})`,
          ),
        );
      });
      server.listen(value, "127.0.0.1", () => {
        server.close((error) => (error ? reject(error) : done(undefined)));
      });
    });
  }
}
