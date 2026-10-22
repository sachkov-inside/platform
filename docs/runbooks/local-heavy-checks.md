# Heavy local checks

How repository commands share the machine's two heavy-check slots.

## Automatic slots for heavy local checks

Use the checked-in `pnpm` commands for heavy checks. `scripts/heavy-check.sh` admits at most two
independent command trees across all worktrees on this machine. A third invocation prints
`heavy-check: waiting for one of two local slots` and waits; admission needs no coordinator request.

The wrappers cover root `check`, `check:full`, `check:ui`, `check:web-e2e`, `test`, `test:tooling`,
`test:integration` (including its parallel and serial commands), `test:e2e`, `test:navigation`,
`test:storybook`, `evidence:web`, `build:storybook`, `compose:smoke`, `compose:production:smoke`, `release:images:smoke` and root `smoke:*` commands. Web's browser, Playwright and Storybook build commands,
and backend's integration and smoke commands also claim slots when called with `pnpm --filter`.
The local contract commands also claim slots. `lint`, `typecheck` and isolated unit commands do not claim slots. The lightweight web
`smoke:backend` HTTP probe stays unwrapped: Compose smoke admits the whole run on the host,
and its Alpine container needs neither Bash nor Python for this probe. Raw runner binaries and direct
smoke scripts bypass admission; use the guarded `pnpm` commands, or wrap a custom command explicitly:

```bash
bash scripts/heavy-check.sh bash -c 'your-command'
```

Local admission requires Python 3 and POSIX `flock` from its standard library; no `flock` executable
is required on macOS. macOS uses `kqueue` and `libproc`; Linux requires Python with `os.pidfd_open`
and a kernel that supports pidfds (Python 3.9+ and Linux 5.3+). The two persistent slot files,
`queue.lock` and the `waiters/` ticket directory live in `~/.cache/inside-platform/heavy-check/`.
Do not remove them while checks run: the kernel owns their locks, and empty files do not mean
occupied slots. `INSIDE_HEAVY_CHECK_DIRECTORY` is for isolated lock tests; normal sessions must
keep the shared default. CI bypasses admission before invoking Python and retains workflow scheduling.

Nested commands reuse their ancestor's slot. New invocations register tickets under a short queue
lock; the oldest live ticket claims the next available slot (FIFO). A later invocation cannot
bypass an older registered waiter. Cancelled or killed waiters release their ticket's kernel lock;
admission removes unlocked older tickets as the queue advances. Waiting invocations retry admission every 1.5–2.5
seconds with jitter. Parent exit and cancellation wake them immediately. Slot filenames remain
compatible with pre-FIFO holders and waiters: they can finish without a restart, but their old
admission loop cannot participate in FIFO ordering. Update worktrees to get FIFO for new runs.
A holder waits for process
events rather than polling `ps`. Process identity and ancestry come from `libproc` on macOS and
`/proc` on Linux, without external commands. On macOS, fork events trigger descendant tracking;
on Linux, the supervisor adopts orphaned descendants as a child subreaper. It closes the slot after
the command exits and the tracked groups contain no running processes. On interruption, including SIGKILL of the wrapper or a
launching ancestor such as `pnpm`, it stops the tracked groups before releasing the slot. SIGTERM has a
five-second shutdown budget, then remaining members receive SIGKILL. A crash therefore cannot
leave a stale kernel lock. On macOS, tracking includes detached groups observed after fork events or during shutdown. A custom
command that detaches a child and exits before observation must manage that child itself. Linux
also tracks detached orphans adopted by the supervisor. Use foreground commands for
heavy checks.

Backend and Telegram unit suites set `maxWorkers: 1`, so the recursive unit stage leaves CPU
headroom for a second admitted check instead of giving each application a machine-sized worker pool.
`scripts/heavy-runner-limits.test.mjs` checks their configured limits together with the Web and local
integration limits.
Web Vitest projects set `maxWorkers: 2` in each project, including the browser-mode Storybook
project. Playwright's default suite sets two workers; the other suites inherit or set one.
Local backend integration retains its resource budget with a cap of two workers; its serial project
sets one worker. CI integration retains the resource-based budget.
Tooling's Node test runner executes at most two files at once within one invocation.
These bounds limit repository checks; they do not reserve CPU or memory against other applications.

Admission does not grant ownership of the singleton Compose stand. Keep the [ownership rules](local-stand.md#parallel-worktrees-and-singleton-ownership)
and leave another session's `inside-platform` services and volumes untouched.
