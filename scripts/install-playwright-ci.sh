#!/usr/bin/env bash
set -euo pipefail

# apt still refreshes indexes when .deb archives are cached (#827).
sudo tee /etc/apt/apt.conf.d/99playwright-network >/dev/null <<'APT'
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
Acquire::Retries "1";
APT::Update::Error-Mode "any";
APT

apt_scope=$(mktemp -d /tmp/platform-playwright-apt.XXXXXX)
trap 'rm -rf -- "$apt_scope"' EXIT
node scripts/prepare-playwright-apt-sources.mjs /etc/apt "$apt_scope"

install_system_packages() {
  # Run the deadline as root so it can terminate apt and its root-owned children.
  sudo timeout --signal=KILL 180s env "APT_CONFIG=$apt_scope/apt.conf" "$(command -v node)" \
    apps/web/node_modules/@playwright/test/cli.js install-deps "$@"
}

if install_system_packages "$@"; then
  :
else
  status=$?
  echo "Playwright system packages failed (exit $status); retrying with the HTTPS Ubuntu archive mirror." >&2
  # GitHub images also route Ubuntu sources through apt-mirrors.txt.
  find "$apt_scope" -maxdepth 2 -type f \( -name '*.list' -o -name '*.sources' -o -name 'apt-mirrors.txt' \) \
    -exec sed -i -E \
      -e 's|https?://azure[.]archive[.]ubuntu[.]com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
      -e 's~https?://us-east-2[.]ec2[.]archive[.]ubuntu[.]com/ubuntu([/?#[:space:]]|$)~https://archive.ubuntu.com/ubuntu\1~g' {} +
  install_system_packages "$@"
fi

# Browser downloads do not need apt or root permissions.
pnpm --filter @inside/web exec playwright install "$@"
