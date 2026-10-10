# Actual migration startup diagnosis (#1304 + #1318)

On reviewed source `dc20d70e2dfd444ce9ce68fd2b309b86b124a9e4`, the first actual
`bash scripts/heavy-check.sh pnpm local:stand` finished with exit1. All four builds succeeded;
Compose reported only that `migrations` exited1. Launcher shutdown removed containers and network
without deleting volumes. No full-stand retry followed.

## Causal loop

The same candidate image reproduced exit1 in1.1–1.5seconds through its migration CLI and again
without network or database. pnpm's primary error was in stdout:
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. The migration entrypoint never ran.
A read-only probe with `--config.verify-deps-before-run=error` exposed `Patches were modified`;
this option prevents implicit installation and does not bypass dependency verification.

Pinned pnpm11.27.1 checks patch mtime against `lastValidatedTimestamp`. The cached dependency
install recorded1791574869016ms. The final development `COPY . .` recopied byte-identical patches
with mtime1791580463000ms. pnpm therefore started an implicit install and refused its module
removal without TTY. Merely adding TTY/CI would permit installation rather than fix the cause.

The one-variable positive probe changed only the two patch timestamps inside a disposable owned
container. It verified unchanged bytes, then ran the same strict read-only schema compatibility
command: exit0, PgBoss44, identity
`sha256:84a286420fbdceab8c67eb392811f58170837f53be99ea0014845600f91b1763`.
No install or database mutation ran. Both candidate and retained cached runtime accept this schema.

The fix excludes `patches` only from each development COPY. Dependency-stage COPY still includes
them before its frozen install, so changed patch bytes still invalidate that install cache.
The native regression uses each real backend/web development COPY in a tiny scratch fixture.
It failed before the fix and passed for both applications after it. No registry image was fetched.
The launcher now reads bounded migrations/seed logs before failed-startup shutdown. A process
regression failed before this change and passed after it. pnpm verification remains enabled.

## Current data and availability

Cached recovery used all retained runtime images without build, pull, seed, migration or restore,
after read-only schema compatibility0. Its15containers are healthy; recovery remains the old
runtime and does not prove current candidate delivery. Local interruption lasted about9minutes.

Post-recovery checks confirm14baseline checksums,16identity hashes unchanged,6protected volumes
unchanged, immutable assets144/variants432 unchanged and current journal166materials/436operations/
15resources unchanged. All protected Platform table fingerprints match the pre-launch snapshot;
PgBoss background rows can change. Logto bootstrap/background activity changed `daily_token_usage`,
`logs` and the `logto_configs` fingerprint; no user/grant/course/submission tables changed.
These administrative deltas are recorded rather than called byte equality. Private dumps and
genuine Content credentials remain on the device; old09Oct backups were not restored.
GatewayPID25383/4398 remains live.

## Resource evidence and remaining proof

The original whole-phase monitor keeps its22381187072byte host-free baseline and samples host
and Docker filesystem every250ms. Through diagnosis, global observed peak growth is3694997504bytes
(3.441GiB), including443's auto-install/workspace outputs. This is a measured partial-phase peak,
not final runtime/build/check usage. The8GiB ceiling,10GiB floor and256MiB stop margin are unchanged.
Currentfree around18.5GiB cannot pass the next normal launch's20GiB admission. Root routes only
ownership-verified capacity cleanup. No further installs or foreign prune are allowed.

Actual normal development/production-web success on the corrected exact head, actual baked CSP
header, anonymous denial, disposable guarded smoke and final `pnpm check` remain pending.
Root read back all10CI checks green on olddc20; corrected-head CI and committed review remain required.
Content alone supplies the paired genuine learner133asset desktop/mobile render after root resumes it.
The source manifest names private raw command/error/status/cleanup receipts and their SHA256 hashes;
it does not copy private database rows or credentials into the repository.
