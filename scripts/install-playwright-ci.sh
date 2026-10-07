#!/usr/bin/env bash
set -euo pipefail

# apt still refreshes indexes when .deb archives are cached (#827).
sudo tee /etc/apt/apt.conf.d/99playwright-network >/dev/null <<'APT'
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
Acquire::Retries "1";
APT::Update::Error-Mode "any";
APT

install_system_packages() {
  # Run the deadline as root so it can terminate apt and its root-owned children.
  sudo timeout --kill-after=10s 180s "$(command -v node)" \
    apps/web/node_modules/@playwright/test/cli.js install-deps "$@"
}

if install_system_packages "$@"; then
  :
else
  status=$?
  echo "Playwright system packages failed (exit $status); retrying with the Ubuntu archive mirror." >&2
  # GitHub images can use either traditional sources.list or deb822 .sources files.
  sudo find /etc/apt -maxdepth 2 -type f \( -name '*.list' -o -name '*.sources' \) \
    -exec sed -i 's|://azure.archive.ubuntu.com/ubuntu|://archive.ubuntu.com/ubuntu|g' {} +
  install_system_packages "$@"
fi

# Browser downloads do not need apt or root permissions.
pnpm --filter @inside/web exec playwright install "$@"
