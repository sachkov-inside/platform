#!/usr/bin/env bash
set -euo pipefail

# apt still refreshes indexes when .deb archives are cached (#827).
sudo tee /etc/apt/apt.conf.d/99playwright-network >/dev/null <<'APT'
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
Acquire::Retries "1";
APT::Update::Error-Mode "any";
APT

apt_workspace=$(mktemp -d /tmp/platform-playwright-apt.XXXXXX)
trap 'rm -rf -- "$apt_workspace"' EXIT
apt_scope=$apt_workspace
node scripts/prepare-playwright-apt-sources.mjs /etc/apt "$apt_scope"

# Ask the pinned Playwright CLI for the direct packages for these engines. Its
# Linux dry run calls apt-get install -s. Capture that argv without running APT.
mkdir "$apt_scope/plan"
cat > "$apt_scope/plan/apt-get" <<'PLAN'
#!/usr/bin/env bash
set -eu
[[ $# -gt 3 && $1 == install && $2 == -s && $3 == --no-install-recommends ]]
shift 3
for package do
  [[ $package =~ ^[a-z0-9][a-z0-9.+-]*$ ]] || exit 1
done
printf '%s\n' "$@" > "$PLAYWRIGHT_PACKAGE_PLAN"
PLAN
chmod +x "$apt_scope/plan/apt-get"
if ! PLAYWRIGHT_PACKAGE_PLAN="$apt_scope/packages" PATH="$apt_scope/plan:$PATH" \
  node apps/web/node_modules/@playwright/test/cli.js install-deps --dry-run "$@" > "$apt_scope/plan.log"; then
  cat "$apt_scope/plan.log" >&2
  exit 1
fi
[[ -s "$apt_scope/packages" ]] || { echo "Missing Playwright package plan" >&2; exit 1; }
packages=()
while IFS= read -r package; do packages+=("$package"); done < "$apt_scope/packages"

acquire_packages() {
  sudo timeout --signal=KILL 180s env "APT_CONFIG=$apt_scope/apt.conf" bash -ec \
    'apt-get update && apt-get install -y --no-install-recommends --download-only "$@"' _ "${packages[@]}"
}

if acquire_packages; then
  :
else
  status=$?
  echo "Playwright package acquisition failed (exit $status); retrying with the HTTPS Ubuntu archive mirror." >&2
  # Some runner images configure noble-security as a separate direct HTTP source.
  apt_scope=$(mktemp -d "$apt_workspace/fallback.XXXXXX")
  node scripts/prepare-playwright-apt-sources.mjs "$apt_workspace" "$apt_scope" --security-fallback
  # GitHub images also route Ubuntu sources through apt-mirrors.txt.
  find "$apt_scope" -maxdepth 2 -type f \( -name '*.list' -o -name '*.sources' -o -name 'apt-mirrors.txt' \) \
    -exec sed -i -E \
      -e 's|https?://azure[.]archive[.]ubuntu[.]com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
      -e 's~https?://us-east-2[.]ec2[.]archive[.]ubuntu[.]com/ubuntu([/?#[:space:]]|$)~https://archive.ubuntu.com/ubuntu\1~g' {} +
  acquire_packages
fi

# Only this call may change dpkg state. Wait for it under the workflow job
# deadline, and propagate its failure without a mirror retry.
sudo env "APT_CONFIG=$apt_scope/apt.conf" apt-get install -y --no-install-recommends --no-download "${packages[@]}"

# Browser downloads do not need apt or root permissions.
pnpm --filter @inside/web exec playwright install "$@"
