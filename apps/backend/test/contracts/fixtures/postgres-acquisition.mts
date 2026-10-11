import setup from "../../integration/setup/postgres.global.js";

const runs = Number(process.argv[2] ?? "1");
for (let run = 0; run < runs; run += 1) {
  try {
    await setup({
      isRootProject: () => true,
      provide: () => {
        throw new Error("Fixture unexpectedly published database context");
      },
    });
    throw new Error("Fixture unexpectedly completed SQL setup");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.log(error.message);
  }
}
