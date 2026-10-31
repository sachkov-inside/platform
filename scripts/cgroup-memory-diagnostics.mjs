// @ts-check
import {
  closeSync,
  constants,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

const membershipFile = "/proc/self/cgroup";
const mount = "/sys/fs/cgroup";
const limit = 4096;
/** Read only fixed kernel interfaces. The caller supplies no path or root override.
 * @param {string} file
 */
function read(file) {
  let fd;
  try {
    fd = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const buffer = Buffer.alloc(limit + 1);
    const count = readSync(fd, buffer, 0, buffer.length, null);
    return {
      availability: "available",
      value: buffer.subarray(0, Math.min(count, limit)).toString(),
      truncated: count > limit,
    };
  } catch (error) {
    return {
      availability:
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "missing"
          : "error",
      value: "",
      truncated: false,
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function observe() {
  const membership = read(membershipFile);
  const context = {
    scope: "current-process",
    membership: {
      availability: membership.availability,
      truncated: membership.truncated,
    },
  };
  if (membership.availability !== "available" || membership.truncated)
    return { ...context, availability: "unavailable" };
  const rows = membership.value.trim().split("\n");
  const groups = rows.flatMap((row) => {
    const match = /^(\d+):([^:]*):(\/.*)$/u.exec(row);
    if (!match) return [];
    const [, id, controllers, group] = match;
    if (!group) return [];
    if (id === "0" && controllers === "") return [{ version: 2, group }];
    if (controllers?.split(",").includes("memory"))
      return [{ version: 1, group }];
    return [];
  });
  const legacyMemory = groups.filter((entry) => entry.version === 1);
  const candidates = legacyMemory.length > 0 ? legacyMemory : groups;
  const selected = candidates.length === 1 ? candidates[0] : undefined;
  // A proc membership can select a descendant, never another file or mount.
  if (
    !selected ||
    (selected.group !== "/" &&
      !/^\/(?:[A-Za-z0-9_.@:-]+\/)*[A-Za-z0-9_.@:-]+$/u.test(selected.group)) ||
    selected.group.split("/").some((part) => part === "." || part === "..")
  )
    return { ...context, availability: "unavailable" };
  const { version, group } = selected;
  const root = version === 2 ? mount : join(mount, "memory");
  const directory = join(root, group);
  try {
    if (realpathSync(directory) !== join(realpathSync(root), group, "."))
      return { ...context, availability: "unavailable" };
  } catch (error) {
    // A missing descendant still gets explicit per-file availability below.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      return { ...context, availability: "unavailable" };
  }
  const names =
    version === 2
      ? ["memory.max", "memory.current", "memory.events"]
      : [
          "memory.limit_in_bytes",
          "memory.usage_in_bytes",
          "memory.failcnt",
          "memory.oom_control",
        ];
  return {
    ...context,
    availability: "resolved",
    version,
    group,
    mount: root,
    type:
      version === 2
        ? read(join(directory, "cgroup.type"))
        : { availability: "not-applicable-v1" },
    controllers:
      version === 2
        ? read(join(mount, "cgroup.controllers"))
        : { availability: "available", value: "memory" },
    files: Object.fromEntries(
      names.map((name) => [
        name,
        version === 2 && group === "/"
          ? { availability: "not-applicable-root" }
          : read(join(directory, name)),
      ]),
    ),
  };
}

if (process.argv.length !== 2) {
  console.error("Cgroup observation accepts no arguments");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(observe()));
}
