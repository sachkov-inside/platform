export default {
  test: {
    maxWorkers: 1,
    include: ["*.case.ts"],
    // Synthetic hook-timeout canary, never the real fixture's budget (#2417).
    hookTimeout: 150,
  },
};
