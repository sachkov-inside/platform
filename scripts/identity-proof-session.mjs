import { readIdentityProofPort } from "./identity-proof-environment.mjs";

export async function runIdentityProofSession({
  environment,
  readGeneratedEnvironment,
  runCompose,
  runPnpm,
  shouldStop = () => false,
}) {
  const identityEnvironment = {
    ...environment,
    COMPOSE_PROJECT_NAME: "inside-identity-proof",
  };
  const platformEnvironment = {
    ...environment,
    COMPOSE_PROJECT_NAME: "inside-platform",
    OBJECT_STORAGE_CONSOLE_HOST_PORT: "9001",
    OBJECT_STORAGE_HOST_PORT: "9000",
    POSTGRES_HOST_PORT: String(
      readIdentityProofPort(
        environment,
        "IDENTITY_PROOF_POSTGRES_PORT",
        5432,
      ),
    ),
  };

  if (await hasRunningServices(runCompose, "platform", platformEnvironment)) {
    throw new Error(
      "The Platform Compose stack is already running and belongs to another session. Stop it through its owner's handoff before starting the identity proof.",
    );
  }
  if (await hasRunningServices(runCompose, "identity", identityEnvironment)) {
    throw new Error(
      "The disposable Logto proof is already running and belongs to another session. Stop it through its owner's handoff before starting a new proof.",
    );
  }

  let ownsIdentity = false;
  let ownsPlatform = false;
  try {
    assertNotStopped(shouldStop);
    await runPnpm(["identity:proof:certs"], identityEnvironment);
    assertNotStopped(shouldStop);
    ownsIdentity = true;
    await runCompose("identity", ["up", "-d", "--wait"], identityEnvironment);
    assertNotStopped(shouldStop);
    await runPnpm(["identity:proof:bootstrap"], identityEnvironment);
    assertNotStopped(shouldStop);

    const runtimeEnvironment = {
      ...environment,
      ...await readGeneratedEnvironment(),
    };
    assertNotStopped(shouldStop);
    ownsPlatform = true;
    await runCompose(
      "platform",
      ["up", "-d", "--wait", "postgres", "object-storage"],
      platformEnvironment,
    );
    assertNotStopped(shouldStop);
    await runPnpm(
      ["--filter", "@inside/backend", "db:migrate"],
      runtimeEnvironment,
    );
    assertNotStopped(shouldStop);
    await runPnpm(["identity:proof:dev"], runtimeEnvironment);
  } finally {
    if (ownsPlatform) {
      await runCompose("platform", ["down"], platformEnvironment).catch(
        () => undefined,
      );
    }
    if (ownsIdentity) {
      await runCompose("identity", ["down"], identityEnvironment).catch(
        () => undefined,
      );
    }
  }
}

function assertNotStopped(shouldStop) {
  if (shouldStop()) {
    throw new Error("Identity proof startup was interrupted");
  }
}

async function hasRunningServices(runCompose, project, environment) {
  const output = await runCompose(
    project,
    ["ps", "--services", "--status", "running"],
    environment,
    true,
  );
  return output.trim().length > 0;
}
