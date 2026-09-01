export function readIdentityProofPort(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

export function readIdentityProofEndpoints(environment) {
  const apiPort = readIdentityProofPort(
    environment,
    "IDENTITY_PROOF_API_PORT",
    3001,
  );
  const webPort = readIdentityProofPort(
    environment,
    "IDENTITY_PROOF_WEB_PORT",
    3000,
  );
  return {
    apiPort,
    backendBaseUrl: `http://127.0.0.1:${String(apiPort)}`,
    webBaseUrl: `http://127.0.0.1:${String(webPort)}`,
    webPort,
  };
}

export function isolateIdentityProofEnvironment(environment, envSources) {
  const isolated = { ...environment };
  for (const source of envSources) {
    for (const line of source.split(/\r?\n/u)) {
      const name = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)?.[1];
      if (
        name !== undefined &&
        !name.startsWith("IDENTITY_PROOF_") &&
        environment[name] === undefined
      ) {
        isolated[name] = "";
      }
    }
  }
  return isolated;
}
