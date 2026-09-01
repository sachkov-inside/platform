export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { readWebRuntimeConfig } = await import(
    "./src/shared/config/index.server"
  );
  readWebRuntimeConfig();
}
