// Test-only preload. It observes this owned Node process and does not install a signal owner.
process.stdout.write(
  JSON.stringify({
    kind: "telegram-main-child",
    pid: process.pid,
    node: process.version,
  }) + "\n",
);
