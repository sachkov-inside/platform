/**
 * #569: measured fork RSS is below 512 MiB; allow 1 GiB per active file for its fork and
 * PostgreSQL work. Keep half the available memory and CPU slots for the runner, Docker and
 * another session. Sample at startup: this bounds concurrency, not future external load.
 */
const memoryBytesPerFile = 1024 ** 3;
const resourceShare = 2;

export function integrationWorkerBudget(resources: {
  availableCpuCount: number;
  availableMemoryBytes: number;
  isolatedRunner?: boolean;
}): number {
  if (resources.isolatedRunner === true) {
    // Hosted runners are dedicated to this job. Reserve one CPU and 2 GiB for Docker
    // and the runner, and cap this measured experiment at three active files.
    return Math.max(
      1,
      Math.min(
        3,
        resources.availableCpuCount - 1,
        Math.floor(
          (resources.availableMemoryBytes - 2 * memoryBytesPerFile) /
            memoryBytesPerFile,
        ),
      ),
    );
  }
  return Math.max(
    1,
    Math.min(
      Math.floor(resources.availableCpuCount / resourceShare),
      Math.floor(
        resources.availableMemoryBytes / resourceShare / memoryBytesPerFile,
      ),
    ),
  );
}
